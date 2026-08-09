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
      checkMetaValid(doc, rel, failures)
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
 * `$ref` is not the only thing that points into `$defs`. `discriminator.mapping`
 * values are JSON Pointers too, and a rename that misses one leaves a mapping
 * naming a definition that no longer exists — the document still compiles, and
 * every check above still passes.
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
  // strict:false — the seeded schemas carry OpenAPI vendor extensions
  // (x-additionalPropertiesName) that Ajv's strict mode rejects but 2020-12
  // explicitly permits.
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false,
  })
  try {
    ajv.compile(doc)
  } catch (error) {
    failures.add(`${rel}: not a valid JSON Schema 2020-12 document — ${(error as Error).message}`)
  }
}

main()
