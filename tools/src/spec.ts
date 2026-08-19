/**
 * Shared helpers for the specification tooling.
 *
 * NON-NORMATIVE. Nothing in tools/ defines the contract; it only builds and
 * checks the artifacts that do.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SPECIFICATIONS_DIR = join(REPO_ROOT, 'specifications')
export const CONFORMANCE_DIR = join(REPO_ROOT, 'conformance')
export const SITE_DIR = join(REPO_ROOT, 'site')

/** The public hostname the published schemas are served from. */
export const SITE_HOST = 'schemas.musher.dev'
export const SCHEMA_ORIGIN = `https://${SITE_HOST}`
export const METASCHEMA = 'https://json-schema.org/draft/2020-12/schema'

/** This repository, for the links the published pages make back to the prose. */
export const REPO_URL = 'https://github.com/musher-dev/spec'

export interface Family {
  /** Family name, e.g. `component`. */
  readonly name: string
  /** Major-version directory, e.g. `v1`. */
  readonly major: string
  /** Absolute path to `specifications/<name>/<major>`. */
  readonly dir: string
  readonly srcDir: string
  readonly distDir: string
  readonly examplesDir: string
  /** Absolute path to the family's normative prose. */
  readonly specPath: string
  /** Absolute path to the generated bundle. */
  readonly bundlePath: string
  /** Canonical publication URL of the bundle within its major-version alias. */
  readonly bundleUrl: string
  /** Absolute path to `conformance/<name>/<major>`, whether or not it exists. */
  readonly conformanceDir: string
}

const DIR_NAME = /^[a-z][a-z0-9-]*$/
const MAJOR_DIR = /^v\d+$/

function listDirs(parent: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(parent)
  } catch {
    return []
  }
  return entries.filter((e) => statSync(join(parent, e)).isDirectory()).sort()
}

/**
 * Discover every `specifications/<family>/v<major>` tree.
 *
 * Returns an empty array when nothing has been authored yet — every tool must
 * treat that as success, not as an error, so the harness stays green on a
 * freshly scaffolded family.
 */
export function discoverFamilies(repoRoot: string = REPO_ROOT): Family[] {
  const specificationsDir = join(repoRoot, 'specifications')
  const conformanceRoot = join(repoRoot, 'conformance')
  const families: Family[] = []
  for (const name of listDirs(specificationsDir)) {
    if (!DIR_NAME.test(name)) {
      throw new Error(`specifications/${name}: family directory must be lowercase kebab-case`)
    }
    for (const major of listDirs(join(specificationsDir, name))) {
      if (!MAJOR_DIR.test(major)) {
        throw new Error(`specifications/${name}/${major}: version directory must match v<MAJOR>`)
      }
      const dir = join(specificationsDir, name, major)
      families.push({
        name,
        major,
        dir,
        srcDir: join(dir, 'schemas', 'src'),
        distDir: join(dir, 'schemas', 'dist'),
        examplesDir: join(dir, 'examples'),
        specPath: join(dir, 'spec.md'),
        bundlePath: join(dir, 'schemas', 'dist', `${name}.schema.json`),
        bundleUrl: `${SCHEMA_ORIGIN}/${name}/${major}/${name}.schema.json`,
        conformanceDir: join(conformanceRoot, name, major),
      })
    }
  }
  return families
}

/** Absolute paths of every `*.schema.json` module authored for a family. */
export function sourceModules(family: Family): string[] {
  let entries: string[]
  try {
    entries = readdirSync(family.srcDir)
  } catch {
    return []
  }
  return entries
    .filter((e) => e.endsWith('.schema.json'))
    .sort()
    .map((e) => join(family.srcDir, e))
}

/** The module that is the family's entry point, if it has been authored. */
export function rootModulePath(family: Family): string {
  return join(family.srcDir, `${family.name}.schema.json`)
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json
}

// Accepts `undefined` so callers can test an index access directly —
// `noUncheckedIndexedAccess` widens every `obj.key` lookup to `Json | undefined`.
export function isObject(value: Json | undefined): value is { [k: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Keywords that lead a schema object, in fixed order. Everything else is
 * emitted alphabetically, with `$defs` last. Stable ordering is what makes the
 * drift check a byte comparison rather than a semantic diff.
 */
const LEADING_KEYS = ['$schema', '$id', '$anchor', 'title', 'description', '$comment']

function canonicalize(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isObject(value)) return value

  const keys = Object.keys(value)
  const leading = LEADING_KEYS.filter((k) => keys.includes(k))
  const trailing = keys.includes('$defs') ? ['$defs'] : []
  const middle = keys.filter((k) => !leading.includes(k) && !trailing.includes(k)).sort()

  const out: { [k: string]: Json } = {}
  for (const key of [...leading, ...middle, ...trailing]) {
    out[key] = canonicalize(value[key] as Json)
  }
  return out
}

/** Deterministic serialization used for every generated artifact. */
export function canonicalJson(value: Json): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

/** Escape a single JSON Pointer reference token (RFC 6901 §3). */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * Walk every nested object in a schema document, root included, pairing each
 * with the JSON Pointer that locates it. The pointer is what lets a diagnostic
 * name the offending subschema instead of describing it.
 */
export function* walkObjects(
  node: Json,
  pointer = '',
): Generator<{ node: { [k: string]: Json }; pointer: string }> {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) yield* walkObjects(item, `${pointer}/${index}`)
    return
  }
  if (!isObject(node)) return
  yield { node, pointer }
  for (const key of Object.keys(node)) {
    yield* walkObjects(node[key] as Json, `${pointer}/${escapePointerToken(key)}`)
  }
}

export function relativeToRepo(path: string): string {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path
}

/** Collected failures, reported together so one run surfaces every problem. */
export class Failures {
  private readonly items: string[] = []

  add(message: string): void {
    this.items.push(message)
  }

  get count(): number {
    return this.items.length
  }

  /** Print all failures and exit non-zero, or print `okMessage` and return. */
  report(okMessage: string): void {
    if (this.items.length === 0) {
      console.log(okMessage)
      return
    }
    for (const item of this.items) console.error(`  ✗ ${item}`)
    console.error(`\n${this.items.length} problem(s) found.`)
    process.exit(1)
  }
}
