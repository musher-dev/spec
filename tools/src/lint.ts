/**
 * Structural integrity checks over the authored schema modules.
 *
 * Runs before bundling, so a malformed module is reported as a module problem
 * rather than as a confusing bundler crash.
 */
import Ajv2020 from 'ajv/dist/2020.js'
import {
  discoverFamilies,
  Failures,
  isObject,
  type Json,
  METASCHEMA,
  readJson,
  relativeToRepo,
  SCHEMA_ORIGIN,
  sourceModules,
  walkObjects,
} from './spec.ts'

const DEFS_NAME = /^[A-Z][A-Za-z0-9]*$/
const MODULE_NAME = /^[a-z][a-z0-9-]*\.schema\.json$/
const SEEDED_AFFIX = /^Seed|Request$/

function main(): void {
  const failures = new Failures()
  const families = discoverFamilies()
  const seenIds = new Map<string, string>()
  let moduleCount = 0

  for (const family of families) {
    const modules = sourceModules(family)
    if (modules.length === 0) {
      console.log(`  · ${family.name}/${family.major}: no modules authored yet`)
      continue
    }

    const hasRoot = modules.some((m) => m.endsWith(`/${family.name}.schema.json`))
    if (!hasRoot) {
      failures.add(
        `${family.name}/${family.major}: no entry-point module — expected ` +
          `schemas/src/${family.name}.schema.json`,
      )
    }

    // The bundler cannot yet embed a second module correctly. It keeps an
    // embedded module's `$id`, which makes it a separate schema resource under
    // 2020-12, while hoisting that module's `$defs` to the bundle root — so an
    // internal `#/$defs/Foo` inside it would resolve against its own base URI
    // and find nothing. `assertSelfContained` would not catch it either: that
    // check is lexical and resolves against the root's `$defs`, where `Foo`
    // does exist. The result would be a bundle that passes every gate and no
    // validator can resolve.
    //
    // Lifting this needs the bundler fixed, a fixture exercising exactly that
    // shape, and two independent validators agreeing on the output. Until then
    // one module per family is the supported configuration, and saying so here
    // is better than discovering it in a published bundle.
    if (modules.length > 1) {
      failures.add(
        `${family.name}/${family.major}: ${modules.length} source modules, but the ` +
          'bundler supports one. Embedding a second would hoist its $defs away from ' +
          'the $id they resolve under. See tools/src/bundle.ts.',
      )
    }

    for (const path of modules) {
      moduleCount += 1
      const rel = relativeToRepo(path)
      const fileName = path.split('/').pop() ?? ''

      if (!MODULE_NAME.test(fileName)) {
        failures.add(`${rel}: filename must be <concept>.schema.json, lowercase kebab-case`)
      }

      let doc: Json
      try {
        doc = readJson(path)
      } catch (error) {
        failures.add(`${rel}: not valid JSON — ${(error as Error).message}`)
        continue
      }

      if (!isObject(doc)) {
        failures.add(`${rel}: root must be an object`)
        continue
      }

      checkDialect(doc, rel, failures)
      checkId(doc, rel, family.name, family.major, seenIds, failures)
      checkRefs(doc, rel, failures)
      checkClosedObjects(doc, rel, failures)
      checkDefsNames(doc, rel, failures)
      checkDefsPointers(doc, rel, failures)
      checkTitlePlacement(doc, rel, failures)
      checkExtensionKeywords(doc, rel, failures)
      checkPatternPortability(doc, rel, failures)
      checkNoUnfinishedText(doc, rel, failures)
      checkMetaValid(doc, rel, failures)
      checkAnnotationsValidate(doc, rel, failures)
    }
  }

  if (moduleCount === 0) {
    console.log('No schema modules authored yet — nothing to lint.')
    return
  }
  failures.report(
    `Linted ${moduleCount} schema module(s) across ${families.length} family tree(s).`,
  )
}

function checkDialect(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  if (doc.$schema !== METASCHEMA) {
    failures.add(`${rel}: $schema must be "${METASCHEMA}", got ${JSON.stringify(doc.$schema)}`)
  }
}

function checkId(
  doc: { [k: string]: Json },
  rel: string,
  family: string,
  major: string,
  seenIds: Map<string, string>,
  failures: Failures,
): void {
  const id = doc.$id
  if (typeof id !== 'string') {
    failures.add(`${rel}: $id is required and must be a string`)
    return
  }
  const prefix = `${SCHEMA_ORIGIN}/${family}/${major}/`
  if (!id.startsWith(prefix)) {
    failures.add(`${rel}: $id must start with ${prefix}, got ${id}`)
  }
  if (id.endsWith('/')) {
    failures.add(`${rel}: $id must not end with a trailing slash`)
  }
  const previous = seenIds.get(id)
  if (previous !== undefined) {
    failures.add(`${rel}: $id ${id} is already used by ${previous}`)
  } else {
    seenIds.set(id, rel)
  }
}

/**
 * Every reference must resolve inside the document. A published bundle that
 * reaches over the network breaks offline validation, stalls editors on a slow
 * origin, and hands every validator an SSRF primitive.
 */
function checkRefs(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  const defs = isObject(doc.$defs) ? doc.$defs : {}
  for (const { node } of walkObjects(doc)) {
    for (const keyword of ['$ref', '$dynamicRef'] as const) {
      const ref = node[keyword]
      if (typeof ref !== 'string') continue
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) {
        failures.add(`${rel}: remote ${keyword} is forbidden — ${ref}`)
        continue
      }
      if (keyword === '$dynamicRef') continue
      if (!ref.startsWith('#/$defs/')) {
        failures.add(`${rel}: ${keyword} must point into #/$defs/ — ${ref}`)
        continue
      }
      const target = decodeURIComponent(ref.slice('#/$defs/'.length))
      if (!(target in defs)) {
        failures.add(`${rel}: ${keyword} ${ref} does not resolve — no $defs/${target}`)
      }
    }
  }
}

/**
 * Every object schema must close itself. `spec.md` §2 requires unknown
 * properties to be rejected "at every level", and JSON Schema only does that
 * where `additionalProperties: false` is written down — an omission validates a
 * typo'd optional key clean and silently falls back to the default.
 *
 * Only schemas that declare `properties` are records. A schema using
 * `additionalProperties` as a map value schema (`inputs`, `endpoints`,
 * `arguments`) declares no `properties` and is deliberately open, because its
 * keys are chosen by the document author.
 */
function checkClosedObjects(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  for (const { node, pointer } of walkObjects(doc)) {
    if (node.type !== 'object' || !isObject(node.properties)) continue
    if (node.additionalProperties === false) continue
    failures.add(
      `${rel}: ${pointer || '<root>'} declares properties but not ` +
        '"additionalProperties": false — unknown properties MUST be rejected at every level',
    )
  }
}

function checkDefsNames(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  if (!isObject(doc.$defs)) return
  for (const name of Object.keys(doc.$defs)) {
    if (!DEFS_NAME.test(name)) {
      failures.add(`${rel}: $defs/${name} must be UpperCamelCase`)
    }
    // The schemas were seeded from the platform's generated wire models, which
    // named things after the pipeline that produced them. A published document
    // contract has no authoring stage and no wire direction, so neither affix
    // describes anything a reader of this repository can act on.
    if (SEEDED_AFFIX.test(name)) {
      failures.add(
        `${rel}: $defs/${name} carries an implementation affix — "Seed" marks a ` +
          'platform authoring concept and "Request" a wire direction; name the concept instead',
      )
    }
  }
}

/**
 * `$ref` is not the only thing that points into `$defs`.
 * `x-musher-discriminator.mapping` values are JSON Pointers too, and a rename
 * that misses one leaves a mapping naming a definition that no longer exists —
 * the document still compiles, and every check above still passes.
 */
function checkDefsPointers(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  const defs = isObject(doc.$defs) ? doc.$defs : {}
  for (const { node, pointer } of walkObjects(doc)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' || key === '$dynamicRef') continue // checkRefs owns these
      if (typeof value !== 'string' || !value.startsWith('#/$defs/')) continue
      const target = decodeURIComponent(value.slice('#/$defs/'.length))
      if (!(target in defs)) {
        failures.add(`${rel}: ${pointer}/${key} points at a missing $defs/${target}`)
      }
    }
  }
}

/**
 * `title` is authored, human-facing, and belongs only on a module root — that is
 * the one an IDE schema picker and SchemaStore display.
 *
 * Below the root, every title this repository inherited was generator output: a
 * camelCase property name re-capitalised (`Specversion`, `Builderimage`), or a
 * `$defs` title echoing its own key. Editors render `title` *above*
 * `description`, so a title that only restates the key displaces the sentence
 * that carries the meaning. `spec.md` stays normative over both.
 */
function checkTitlePlacement(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  for (const { node, pointer } of walkObjects(doc)) {
    if (pointer === '' || typeof node.title !== 'string') continue
    failures.add(
      `${rel}: ${pointer} declares a "title" — only a module root may carry one; ` +
        'below it, describe the field in "description"',
    )
  }
}

function checkMetaValid(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  const ajv = strictAjv()
  try {
    ajv.compile(doc)
  } catch (error) {
    failures.add(`${rel}: not a valid JSON Schema 2020-12 document — ${(error as Error).message}`)
  }
}

/**
 * Every keyword this repository uses that JSON Schema 2020-12 does not define.
 *
 * All of them are annotations: they carry no assertion, and removing one would
 * not change what validates. They are listed here rather than waved through by
 * `strict: false`, because the point of strict mode is to catch a *misspelled*
 * keyword — `additionalPropertes`, `minimun` — which 2020-12 ignores silently
 * and which would leave a rule this repository believes it is enforcing doing
 * nothing at all. A document format that rejects unknown instance fields at
 * every level should hold its own schemas to the same standard.
 */
const EXTENSION_KEYWORDS = [
  // Names the key of a map-valued object, for documentation renderers. The
  // keys are chosen by the document author, so no schema can name them.
  'x-additionalPropertiesName',
  // Which `oneOf` branch a reader should expect, keyed on a property. The
  // adjacent `oneOf` and `const` do the actual validation; this is a rendering
  // hint, prefixed to say so. See component §5.1 and §5.3.
  'x-musher-discriminator',
] as const

export function strictAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    // `strictTypes` is Ajv's style opinion, not a correctness rule: it wants a
    // redundant `type` beside every `pattern` or `required`, including inside
    // an `if`/`then` whose containing schema has already fixed the type. Adding
    // those would edit the schemas to satisfy a linter rather than to say
    // anything new, and each edit is a chance to change what validates. What
    // strict mode is switched on for is `strictSchema` — the unknown-keyword
    // check that catches `additionalPropertes` or `minimun` silently doing
    // nothing — and that stays on.
    strictTypes: false,
    allErrors: true,
    // In 2020-12 `format` is an annotation unless the format-assertion
    // vocabulary is explicitly declared, and no Musher schema declares it. No
    // format library is registered, so any `format` keyword is collected as an
    // annotation and asserts nothing — which is the dialect's default
    // behaviour, not a shortcut. Declaring the vocabulary would be a breaking
    // change and needs an ADR.
    validateFormats: false,
  })
  for (const keyword of EXTENSION_KEYWORDS) {
    ajv.addKeyword({ keyword, metaSchema: {} })
  }
  return ajv
}

/**
 * Every `pattern` must compile everywhere, and in linear time.
 *
 * A published pattern is evaluated by validators this repository does not
 * control, in languages whose regex engines do not agree. Go and Rust use RE2,
 * which has no lookaround and no backreferences and refuses to compile one;
 * JavaScript and Python have both, and both can be made to backtrack
 * exponentially. A pattern using either is therefore two different rules — it
 * rejects a document on one implementation and fails to compile on another —
 * and it is the ReDoS surface SECURITY.md names.
 *
 * Several `$comment`s already assert a pattern is "lookahead-free, so it
 * compiles under RE2 as well as ECMA-262". This is that assertion enforced
 * rather than repeated.
 */
const LOOKAROUND = /\((\?=|\?!|\?<=|\?<!)/
const BACKREFERENCE = /\\[1-9]/

function checkPatternPortability(
  doc: { [k: string]: Json },
  rel: string,
  failures: Failures,
): void {
  for (const { node, pointer } of walkObjects(doc)) {
    for (const keyword of ['pattern', 'patternProperties'] as const) {
      const value = node[keyword]
      const patterns =
        keyword === 'pattern'
          ? typeof value === 'string'
            ? [value]
            : []
          : isObject(value)
            ? Object.keys(value)
            : []

      for (const pattern of patterns) {
        const where = `${rel}: ${pointer || '<root>'}/${keyword}`
        if (LOOKAROUND.test(pattern)) {
          failures.add(
            `${where} uses lookaround — ${pattern}. RE2 (Go, Rust) will not compile it, ` +
              'so the rule would differ between implementations.',
          )
        }
        if (BACKREFERENCE.test(pattern)) {
          failures.add(
            `${where} uses a backreference — ${pattern}. RE2 will not compile it, and ` +
              'backtracking engines can be made to run exponentially on one.',
          )
        }
        try {
          new RegExp(pattern, 'u')
        } catch (error) {
          failures.add(`${where} is not a valid regular expression — ${(error as Error).message}`)
        }
      }
    }
  }
}

/**
 * A released schema may not carry unfinished text.
 *
 * `description` is what an editor shows an author at the moment they are
 * writing the field. A `TODO` there is this repository telling every user of
 * every implementation that it has not decided yet, on a URL it has promised
 * never to change.
 */
const UNFINISHED = /\b(TODO|TBD|FIXME|XXX)\b/

function checkNoUnfinishedText(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  for (const { node, pointer } of walkObjects(doc)) {
    for (const keyword of ['title', 'description', '$comment'] as const) {
      const value = node[keyword]
      if (typeof value !== 'string' || !UNFINISHED.test(value)) continue
      failures.add(
        `${rel}: ${pointer || '<root>'}/${keyword} carries unfinished text — ` +
          'a released schema states the rule or omits the field.',
      )
    }
  }
}

/**
 * Every `default` and `examples` entry must satisfy the schema it sits in.
 *
 * Neither keyword asserts anything: a validator collects them as annotations
 * and never checks them, so a `default` that its own schema would reject is
 * invisible forever. It is also the most misleading kind of wrong, because an
 * editor offers it as a completion and generated documentation prints it as
 * the value you get if you say nothing.
 *
 * Checked by compiling the module and asking Ajv for the subschema at each
 * pointer, which is what makes a `$ref` into `$defs` resolve the same way it
 * will for a consumer.
 */
function checkAnnotationsValidate(
  doc: { [k: string]: Json },
  rel: string,
  failures: Failures,
): void {
  const id = typeof doc.$id === 'string' ? doc.$id : undefined
  if (id === undefined) return

  const ajv = strictAjv()
  try {
    ajv.compile(doc)
  } catch {
    // checkMetaValid already reported this; nothing further to say.
    return
  }

  for (const { node, pointer } of walkObjects(doc)) {
    const hasDefault = 'default' in node
    const examples = Array.isArray(node.examples) ? node.examples : []
    if (!hasDefault && examples.length === 0) continue

    let validate: ReturnType<typeof ajv.getSchema>
    try {
      validate = ajv.getSchema(`${id}#${pointer}`)
    } catch {
      continue
    }
    if (validate === undefined) continue

    if (hasDefault && !validate(node.default)) {
      failures.add(
        `${rel}: ${pointer || '<root>'}/default is ${JSON.stringify(node.default)}, which ` +
          `its own schema rejects — ${ajv.errorsText(validate.errors)}`,
      )
    }
    for (const [index, example] of examples.entries()) {
      if (validate(example)) continue
      failures.add(
        `${rel}: ${pointer || '<root>'}/examples/${index} is ${JSON.stringify(example)}, ` +
          `which its own schema rejects — ${ajv.errorsText(validate.errors)}`,
      )
    }
  }
}

/**
 * Nothing outside the allowlist may invent a keyword.
 *
 * Ajv's strict mode catches an unknown keyword where it can infer one is
 * intended, but it cannot distinguish "a Musher extension" from "a typo that
 * happens to look like one". Naming the permitted set makes adding an extension
 * a deliberate, reviewable act rather than a side effect.
 */
function checkExtensionKeywords(doc: { [k: string]: Json }, rel: string, failures: Failures): void {
  for (const { node, pointer } of walkObjects(doc)) {
    for (const key of Object.keys(node)) {
      if (!key.startsWith('x-')) continue
      if ((EXTENSION_KEYWORDS as readonly string[]).includes(key)) continue
      failures.add(
        `${rel}: ${pointer || '<root>'} declares "${key}", which is not an allowed ` +
          `extension. Permitted: ${EXTENSION_KEYWORDS.join(', ')}.`,
      )
    }
  }
}

if (import.meta.main) main()
