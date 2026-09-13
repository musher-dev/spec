/**
 * Shared helpers for the specification tooling, and the one place a repository
 * path is spelled.
 *
 * Every tool asks this module where a family's prose, schemas, examples, and
 * conformance corpus live, rather than writing `specifications/…` itself. That
 * is what lets the layout change in one commit: a path spelled in twenty places
 * is a path that moves in nineteen of them, and the twentieth reads nothing and
 * reports success. `layout.test.ts` fails the suite on a new literal.
 *
 * NON-NORMATIVE. Nothing in tools/ defines the contract; it only builds and
 * checks the artifacts that do.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listTreeFiles, readBlobAtRef } from './git.ts'

// -----------------------------------------------------------------------------
// Repository-relative paths. POSIX, because git names paths that way at a ref
// and a published link must not carry a platform separator.
// -----------------------------------------------------------------------------

/** Where every family's tree lives. */
export const SPECIFICATIONS_ROOT = 'specifications'
/**
 * The conformance suite's own index of profiles and fixture format. It stays at
 * the root because every family's corpus follows it; each corpus itself lives
 * inside its family version (see docs/adr/0021 §2).
 */
export const CONFORMANCE_README = 'conformance/README.md'
/** The publication ledger. See docs/adr/0006. */
export const LEDGER_FILE = 'published.json'
export const RELEASE_PLEASE_MANIFEST_FILE = '.github/release-please/manifest.json'
export const RELEASE_PLEASE_CONFIG_FILE = '.github/release-please/config.json'
/** The generated requirement traceability matrix. */
export const TRACEABILITY_FILE = 'docs/traceability.md'
/** The generated SchemaStore-compatible catalog. */
export const CATALOG_FILE = 'catalog.json'

/**
 * The family whose diagnostics table the other families declare themselves
 * deltas on: blueprint §7 and listing §7 both open "The codes in component §8
 * apply. This family adds:".
 */
export const BASE_FAMILY = 'component'

/**
 * The base family: the Musher Document Core Specification (docs/adr/0022).
 *
 * It defines no `kind` and ships no schema — only prose and a parser-phase
 * corpus. Every other family is a *kind* family, which binds core's parameters
 * in its own §2 and publishes a bundle.
 */
export const CORE_FAMILY = 'core'

/** Whether a family is the schema-less base or a document kind built on it. */
export type FamilyRole = 'core' | 'kind'

export function familyRole(name: string): FamilyRole {
  return name === CORE_FAMILY ? 'core' : 'kind'
}

/** Every repository path belonging to one family version, repo-relative. */
export interface FamilyPaths {
  /** `specifications/<name>/<major>`. */
  readonly dir: string
  readonly spec: string
  /** `schemas/`, which a core family version must not carry. */
  readonly schemas: string
  readonly src: string
  readonly dist: string
  readonly bundle: string
  readonly examples: string
  /** The family version's conformance corpus, whether or not it exists. */
  readonly conformance: string
  /** The key release-please's manifest and config use for this package. */
  readonly manifestKey: string
}

export function familyPaths(name: string, major: string): FamilyPaths {
  const dir = `${SPECIFICATIONS_ROOT}/${name}/${major}`
  return {
    dir,
    spec: `${dir}/spec.md`,
    schemas: `${dir}/schemas`,
    src: `${dir}/schemas/src`,
    dist: `${dir}/schemas/dist`,
    bundle: `${dir}/schemas/dist/${name}.schema.json`,
    examples: `${dir}/examples`,
    conformance: `${dir}/conformance`,
    manifestKey: dir,
  }
}

const FAMILY_SEGMENT = '[a-z][a-z0-9-]*'
const MANIFEST_KEY = new RegExp(`^${SPECIFICATIONS_ROOT}/(${FAMILY_SEGMENT})/(v\\d+)$`)
const SPEC_PATH = new RegExp(`^${SPECIFICATIONS_ROOT}/(${FAMILY_SEGMENT})/(v\\d+)/spec\\.md$`)

/** The family version a release-please manifest key names, or null. */
export function parseManifestKey(key: string): { name: string; major: string } | null {
  const match = MANIFEST_KEY.exec(key)
  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { name: match[1], major: match[2] }
}

/** The family version whose prose a repo-relative path is, or null. */
export function parseSpecPath(path: string): { name: string; major: string } | null {
  const match = SPEC_PATH.exec(path)
  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { name: match[1], major: match[2] }
}

/** A relative link from a repo-relative directory to a repo-relative path. */
export function repoLink(fromDir: string, path: string): string {
  return posix.relative(fromDir, path)
}

/** A relative link from a repo-relative directory to one conformance case directory. */
export function conformanceLink(
  fromDir: string,
  name: string,
  major: string,
  casePath: string,
): string {
  return `${repoLink(fromDir, `${familyPaths(name, major).conformance}/${casePath}`)}/`
}

/** The parts of a family version a released ref is expected to carry. */
export type FamilyPart = 'spec' | 'schema' | 'examples' | 'conformance'

/**
 * Parts a family *role* never carries. Core ships no schema and no examples
 * (docs/adr/0022): its subjects are parser-phase fixtures, not documents of a
 * kind, so there is nothing a bundle could validate or an example illustrate.
 */
const ABSENT_BY_ROLE: { readonly [role in FamilyRole]: readonly FamilyPart[] } = {
  core: ['schema', 'examples'],
  kind: [],
}

/**
 * Family versions that legitimately lack a part beyond their role, keyed
 * `<name>/<major>`.
 *
 * Empty: every kind family version today carries its prose, its schema, its
 * examples, and its corpus. A part not listed here is required at every released
 * ref, so a tool reading a moved or missing path fails instead of finding
 * nothing and passing.
 */
const ABSENT_PARTS: { readonly [familyVersion: string]: readonly FamilyPart[] } = {}

/** Whether the layout says this family version carries `part`. */
export function hasPart(name: string, major: string, part: FamilyPart): boolean {
  if (ABSENT_BY_ROLE[familyRole(name)].includes(part)) return false
  return !(ABSENT_PARTS[`${name}/${major}`] ?? []).includes(part)
}

/** A path the layout promised is not where it should be. */
export class LayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayoutError'
  }
}

export type AtRef =
  | { readonly type: 'blob'; readonly bytes: Buffer }
  | { readonly type: 'tree'; readonly files: string[] }

/**
 * A blob's bytes or a tree's files as of a ref, or a `LayoutError` naming the
 * ref and the path.
 *
 * `readBlobAtRef` and `listTreeFiles` answer absence with `null` and `[]`,
 * which is right for a ref that may carry nothing — a base branch, or `main`
 * before a family exists. At a released tag absence means the layout moved
 * underneath the tool, and an empty answer would let it pass vacuously.
 */
export function requireAtRef(repoRoot: string, ref: string, relPath: string, what: string): AtRef {
  const bytes = readBlobAtRef(repoRoot, ref, relPath)
  if (bytes !== null) return { type: 'blob', bytes }
  const files = listTreeFiles(repoRoot, ref, relPath)
  if (files.length > 0) return { type: 'tree', files }
  throw new LayoutError(
    `${ref}: ${what} is expected at ${relPath}, and that ref carries nothing there. ` +
      'If the layout changed after this release, teach tools/src/lib/layout.ts where it lived.',
  )
}

/** `requireAtRef` for a path that must be a file. */
export function requireFileAtRef(
  repoRoot: string,
  ref: string,
  relPath: string,
  what: string,
): Buffer {
  const found = requireAtRef(repoRoot, ref, relPath, what)
  if (found.type === 'blob') return found.bytes
  throw new LayoutError(`${ref}: ${what} is expected to be a file at ${relPath}, not a directory`)
}

/** `requireAtRef` for a path that must be a directory; returns its files, repo-relative. */
export function requireTreeAtRef(
  repoRoot: string,
  ref: string,
  relPath: string,
  what: string,
): string[] {
  const found = requireAtRef(repoRoot, ref, relPath, what)
  if (found.type === 'tree') return found.files
  throw new LayoutError(`${ref}: ${what} is expected to be a directory at ${relPath}, not a file`)
}

/** A repo-relative POSIX path, made absolute under a repository root. */
export function inRepo(repoRoot: string, relPath: string): string {
  return join(repoRoot, ...relPath.split('/'))
}

/**
 * A family version's `spec.md` at a released ref.
 *
 * Throws `LayoutError` when the ref lacks it. Null only where the layout says
 * the family version carries no prose.
 */
export function releasedSpec(
  repoRoot: string,
  ref: string,
  name: string,
  major: string,
): Buffer | null {
  const path = familyPaths(name, major).spec
  return hasPart(name, major, 'spec')
    ? requireFileAtRef(repoRoot, ref, path, `${name}/${major} spec.md`)
    : readBlobAtRef(repoRoot, ref, path)
}

/**
 * Every file under a family version's examples or conformance corpus at a
 * released ref, repo-relative.
 *
 * Throws `LayoutError` when the ref carries nothing there. Empty only where the
 * layout says the family version has no such part.
 */
export function releasedPartFiles(
  repoRoot: string,
  ref: string,
  name: string,
  major: string,
  part: 'examples' | 'conformance',
): string[] {
  const path = familyPaths(name, major)[part]
  return hasPart(name, major, part)
    ? requireTreeAtRef(repoRoot, ref, path, `${name}/${major} ${part}`)
    : listTreeFiles(repoRoot, ref, path)
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
// A wrong depth does not fail loudly on its own: family discovery finds no
// `specifications/` to walk, returns nothing, and every tool reports success.
if (!existsSync(join(REPO_ROOT, SPECIFICATIONS_ROOT))) {
  throw new Error(
    `REPO_ROOT resolved to ${REPO_ROOT}, which has no specifications/ directory. ` +
      'tools/src/lib/layout.ts derives it from its own location; if the file moved, fix the depth.',
  )
}
export const SPECIFICATIONS_DIR = join(REPO_ROOT, SPECIFICATIONS_ROOT)
export const SITE_DIR = join(REPO_ROOT, 'site')

/** The public hostname the published schemas are served from. */
export const SITE_HOST = 'specifications.musher.dev'
export const SCHEMA_ORIGIN = `https://${SITE_HOST}`
export const METASCHEMA = 'https://json-schema.org/draft/2020-12/schema'

/** This repository, for the links the published pages make back to the prose. */
export const REPO_URL = 'https://github.com/musher-dev/specifications'

export interface Family {
  /** Family name, e.g. `component`. */
  readonly name: string
  /** Major-version directory, e.g. `v1`. */
  readonly major: string
  /** `core` for the schema-less base family, `kind` for every other. */
  readonly role: FamilyRole
  /**
   * Whether `schemas/src` exists in the working tree. False for core, and for a
   * kind family whose schema has not been authored yet; every schema tool skips
   * such a family rather than reporting it.
   */
  readonly hasSchema: boolean
  /** Absolute path to `specifications/<name>/<major>`. */
  readonly dir: string
  /** Absolute path to `schemas/`. */
  readonly schemasDir: string
  readonly srcDir: string
  readonly distDir: string
  readonly examplesDir: string
  /** Absolute path to the family's normative prose. */
  readonly specPath: string
  /** Absolute path to the generated bundle. */
  readonly bundlePath: string
  /** Canonical publication URL of the bundle within its major-version alias. */
  readonly bundleUrl: string
  /** Absolute path to the family version's conformance corpus, whether or not it exists. */
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
 * Discover every `specifications/<family>/v<major>` tree, core first.
 *
 * Core leads because every kind family is built on it: a report read top to
 * bottom states the shared rules before the ones that narrow them. The rest
 * follow in name order, then major order.
 *
 * Returns an empty array when no family tree has been authored yet. A
 * `specifications/` that has children but yields no family is not that state:
 * it is a layout this function no longer recognises, and answering "nothing to
 * check" there would turn every tool green, so it throws.
 */
export function discoverFamilies(repoRoot: string = REPO_ROOT): Family[] {
  const specificationsDir = inRepo(repoRoot, SPECIFICATIONS_ROOT)
  const families: Family[] = []
  const names = listDirs(specificationsDir)
  for (const name of names) {
    if (!DIR_NAME.test(name)) {
      throw new Error(
        `${SPECIFICATIONS_ROOT}/${name}: family directory must be lowercase kebab-case`,
      )
    }
    for (const major of listDirs(join(specificationsDir, name))) {
      if (!MAJOR_DIR.test(major)) {
        throw new Error(
          `${SPECIFICATIONS_ROOT}/${name}/${major}: version directory must match v<MAJOR>`,
        )
      }
      const paths = familyPaths(name, major)
      const srcDir = inRepo(repoRoot, paths.src)
      families.push({
        name,
        major,
        role: familyRole(name),
        hasSchema: existsSync(srcDir),
        dir: inRepo(repoRoot, paths.dir),
        schemasDir: inRepo(repoRoot, paths.schemas),
        srcDir,
        distDir: inRepo(repoRoot, paths.dist),
        examplesDir: inRepo(repoRoot, paths.examples),
        specPath: inRepo(repoRoot, paths.spec),
        bundlePath: inRepo(repoRoot, paths.bundle),
        bundleUrl: `${SCHEMA_ORIGIN}/${name}/${major}/${name}.schema.json`,
        conformanceDir: inRepo(repoRoot, paths.conformance),
      })
    }
  }
  if (families.length === 0 && names.length > 0) {
    throw new LayoutError(
      `${SPECIFICATIONS_ROOT}/ holds ${names.join(', ')} but no family version was found. ` +
        `Expected ${SPECIFICATIONS_ROOT}/<family>/v<MAJOR>/.`,
    )
  }
  // Stable: `names` and each major list are already sorted.
  return [
    ...families.filter((family) => family.role === 'core'),
    ...families.filter((family) => family.role === 'kind'),
  ]
}

/**
 * Every kind family version — each one a document format with a schema. What
 * the catalog, the field reference, and the compatibility replay iterate.
 */
export function discoverKinds(repoRoot: string = REPO_ROOT): Family[] {
  return discoverFamilies(repoRoot).filter((family) => family.role === 'kind')
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
