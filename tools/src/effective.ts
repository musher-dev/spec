/**
 * Effective values — what a document means where it does not say.
 *
 * ADR 0008. A `default` in JSON Schema is an annotation: validators do not
 * insert it, and two conforming implementations may therefore hold different
 * object models for the same accepted document and behave differently later.
 * The specification closes that by defining the **effective value** of an
 * absent field, and the corpus pins it with an `effective` map on a passing
 * case.
 *
 * This module is what keeps that map honest inside this repository. It walks
 * the document and the bundle in step and answers, for one JSON Pointer, what
 * the document effectively says there.
 *
 * It is not a general JSON Schema evaluator and does not try to be. It handles
 * the four shapes this contract actually uses to reach a value — `$ref`,
 * `properties`, `additionalProperties` for a typed mapping, and `items` — plus
 * `anyOf`'s nullable idiom, and it reports anything else as unresolvable
 * rather than guessing. A resolver that guesses is worse than one that stops,
 * because the fixture it green-lights is the one nobody re-reads.
 */
import { isObject, type Json } from './spec.ts'

export type Resolution =
  | { readonly kind: 'written'; readonly value: Json }
  | { readonly kind: 'default'; readonly value: Json }
  | { readonly kind: 'absent'; readonly reason: string }

/** `/spec/workload/health/readiness/periodSeconds` → the five segments. */
export function pointerSegments(pointer: string): string[] {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) throw new Error(`not a JSON Pointer: ${pointer}`)
  // RFC 6901: ~1 is "/" and ~0 is "~", and the order of unescaping matters.
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

/**
 * Follow `$ref`, flatten `allOf`, and pick `anyOf`'s single non-null branch.
 *
 * The nullable idiom in these schemas is `anyOf: [{…}, {"type": "null"}]`, so a
 * branch set with exactly one non-null member is unambiguous and is followed.
 * Two live branches are a real choice this resolver cannot make without
 * evaluating the instance, so it declines.
 */
function deref(bundle: Json, schema: Json, depth = 0): Json {
  if (!isObject(schema) || depth > 32) return schema

  const ref = schema.$ref
  if (typeof ref === 'string') {
    if (!ref.startsWith('#/$defs/')) return schema
    const defs = isObject(bundle) ? bundle.$defs : undefined
    const target = isObject(defs) ? defs[ref.slice('#/$defs/'.length)] : undefined
    if (target === undefined) return schema
    return deref(bundle, target, depth + 1)
  }

  if (Array.isArray(schema.anyOf)) {
    const live = schema.anyOf.filter((branch) => !(isObject(branch) && branch.type === 'null'))
    if (live.length === 1 && live[0] !== undefined) {
      const resolved = deref(bundle, live[0], depth + 1)
      // A `default` on the wrapper outranks one inside the branch: it is what
      // the field says about itself, and the branch is only how it is shaped.
      if (isObject(resolved) && 'default' in schema) {
        return { ...resolved, default: schema.default as Json }
      }
      return resolved
    }
  }

  if (Array.isArray(schema.allOf)) {
    let merged: { [k: string]: Json } = { ...schema }
    delete merged.allOf
    for (const branch of schema.allOf) {
      const resolved = deref(bundle, branch, depth + 1)
      // Only the conditional-free part of an allOf branch can be flattened:
      // if/then/else picks a shape from the instance, which is evaluation.
      if (isObject(resolved) && isObject(resolved.properties)) {
        merged = {
          ...merged,
          properties: {
            ...(isObject(merged.properties) ? merged.properties : {}),
            ...resolved.properties,
          },
        }
      }
    }
    return merged
  }

  return schema
}

/** Descend one pointer segment on the schema side. */
function schemaChild(bundle: Json, schema: Json, segment: string): Json | undefined {
  const here = deref(bundle, schema)
  if (!isObject(here)) return undefined

  if (isObject(here.properties) && segment in here.properties) return here.properties[segment]
  // A typed mapping — `endpoints`, `volumes`, `inputs` — keys by author-chosen
  // name, so any segment lands on the same value schema.
  if (isObject(here.additionalProperties)) return here.additionalProperties
  if (here.items !== undefined && /^\d+$/.test(segment)) return here.items as Json
  return undefined
}

/** Descend one pointer segment on the document side. */
function documentChild(value: Json, segment: string): Json | undefined {
  if (isObject(value)) return segment in value ? value[segment] : undefined
  if (Array.isArray(value) && /^\d+$/.test(segment)) return value[Number(segment)]
  return undefined
}

/**
 * What the document effectively says at `pointer`.
 *
 * `written` where the author supplied a value, `default` where the schema
 * supplies one for an absent field, and `absent` where neither does — which
 * includes the case a fixture is most likely to get wrong: an absent ancestor
 * whose own default is null, so nothing below it exists to have a value.
 */
export function effectiveValue(bundle: Json, document: Json, pointer: string): Resolution {
  let schema: Json | undefined = bundle
  let value: Json | undefined = document
  let present = true
  const walked: string[] = []

  for (const segment of pointerSegments(pointer)) {
    if (schema === undefined) {
      return { kind: 'absent', reason: `/${walked.join('/')} is not a field this schema defines` }
    }

    if (!present) {
      // Already below a field the author omitted. §3: what stands in for it is
      // its default, and a default that is null — or any scalar — has nothing
      // beneath it. Omitting `health` does not confer a readiness probe.
      if (!isObject(value) && !Array.isArray(value)) {
        return {
          kind: 'absent',
          reason:
            `/${walked.join('/')} is absent and its effective value is ` +
            `${JSON.stringify(value ?? null)}, so nothing below it exists to have one`,
        }
      }
      value = documentChild(value, segment)
    } else {
      const nextValue = documentChild(value as Json, segment)
      if (nextValue === undefined) {
        // The author stopped here. This field answers from its own default.
        present = false
        const resolved = deref(bundle, schema)
        const declared =
          isObject(resolved) && isObject(resolved.properties) && segment in resolved.properties
            ? deref(bundle, resolved.properties[segment] as Json)
            : undefined
        value = isObject(declared) && 'default' in declared ? (declared.default as Json) : undefined
      } else {
        value = nextValue
      }
    }

    schema = schemaChild(bundle, schema, segment)
    walked.push(segment)
  }

  if (present) return { kind: 'written', value: value as Json }

  if (value !== undefined) return { kind: 'default', value }

  if (schema !== undefined) {
    const resolved = deref(bundle, schema)
    if (isObject(resolved) && 'default' in resolved) {
      return { kind: 'default', value: resolved.default as Json }
    }
  }

  return {
    kind: 'absent',
    reason:
      `${pointer} is absent and neither it nor an ancestor declares a default — ` +
      'an absent field with no default has no effective value to pin',
  }
}
