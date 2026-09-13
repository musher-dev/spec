/**
 * Compile each family's authored modules into one self-contained compound
 * schema document.
 *
 * The bundle is the artifact consumers actually fetch. Every reference resolves
 * inside `$defs`, so validation never touches the network.
 *
 * It is build output, not a tracked file (docs/adr/0023). In-process consumers
 * call `familyBundle`; only a tool that hands a path to another program calls
 * `ensureBundleFile`, which writes it under `dist/`.
 *
 * The command line is a downstream contract:
 *
 *   bun tools/src/schema/bundle.ts                               dist/ + catalog
 *   bun tools/src/schema/bundle.ts --stdout component/v1         alias bundle
 *   bun tools/src/schema/bundle.ts --stdout component/v1 --version 1.2.0
 *
 * A consumer runs it at a pinned commit without `bun install`, so this module,
 * `sources.ts`, and everything they import use `node:` builtins and nothing
 * else. `bundle.test.ts` scans the import graph to hold that.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  bundleUrl,
  CATALOG_FILE,
  canonicalJson,
  discoverKinds,
  familyPaths,
  inRepo,
  isObject,
  type Json,
  METASCHEMA,
  REPO_ROOT,
  walkObjects,
} from '../lib/layout.ts'
import { buildCatalog } from '../publication/catalog.ts'
import { fsReader, type ModuleReader } from './sources.ts'

/** A family version by name — a discovered `Family` is one, and so is a release. */
export interface FamilyRef {
  readonly name: string
  readonly major: string
  /** Where the working tree lives; `REPO_ROOT` when absent. */
  readonly repoRoot?: string
}

export interface BuildOptions {
  /** Where the modules are read. Defaults to the family's working tree. */
  readonly reader?: ModuleReader
  /** The bundle's `$id`. Defaults to the major-version alias URL. */
  readonly id?: string
}

const MODULE_SUFFIX = '.schema.json'

function label(family: FamilyRef): string {
  return `${family.name}/${family.major}`
}

function parseModule(reader: ModuleReader, path: string): { [k: string]: Json } {
  const bytes = reader.read(path)
  if (bytes === null) throw new Error(`${path}: listed but could not be read`)
  const doc = JSON.parse(bytes.toString('utf8')) as Json
  if (!isObject(doc)) throw new Error(`${path}: root must be an object`)
  return doc
}

/**
 * Build a family's bundle, as canonical JSON text. Null when no module is
 * authored.
 *
 * Deterministic in its reader: modules are taken in name order whatever order
 * the reader lists them, and the output is canonicalized, so the same sources
 * give the same bytes from the working tree and from any ref.
 */
export function buildBundle(family: FamilyRef, options: BuildOptions = {}): string | null {
  const reader = options.reader ?? fsReader(family.repoRoot ?? REPO_ROOT)
  const src = familyPaths(family.name, family.major).src
  const names = reader
    .list(src)
    .filter((name) => name.endsWith(MODULE_SUFFIX))
    .sort()
  if (names.length === 0) return null

  const rootName = `${family.name}${MODULE_SUFFIX}`
  if (!names.includes(rootName)) {
    throw new Error(`${label(family)}: missing ${src}/${rootName}`)
  }

  const root = parseModule(reader, `${src}/${rootName}`)
  const defs: { [k: string]: Json } = isObject(root.$defs) ? { ...root.$defs } : {}

  // Embed every non-root module as a $defs member keyed by its concept name,
  // and hoist its own $defs alongside. A 2020-12 compound schema document
  // keeps each embedded resource's $id, so identity survives the inlining.
  for (const name of names) {
    if (name === rootName) continue
    const path = `${src}/${name}`
    const doc = parseModule(reader, path)
    const key = conceptToDefName(name.slice(0, -MODULE_SUFFIX.length))

    if (isObject(doc.$defs)) {
      for (const [defName, value] of Object.entries(doc.$defs)) {
        if (defName in defs) {
          throw new Error(`${path}: $defs/${defName} collides with an existing definition`)
        }
        defs[defName] = value
      }
    }

    const embedded: { [k: string]: Json } = {}
    for (const [field, value] of Object.entries(doc)) {
      if (field === '$defs' || field === '$schema') continue
      embedded[field] = value
    }
    if (key in defs) {
      throw new Error(`${path}: $defs/${key} collides with an existing definition`)
    }
    defs[key] = embedded
  }

  const bundle: { [k: string]: Json } = {}
  for (const [field, value] of Object.entries(root)) {
    if (field === '$defs') continue
    bundle[field] = value
  }

  // The bundle's $id is its real publication URL — the file a consumer fetches.
  // Source modules carry extensionless conceptual identifiers instead; they are
  // never served on their own.
  bundle.$schema = METASCHEMA
  bundle.$id = options.id ?? bundleUrl(family.name, family.major)
  if (Object.keys(defs).length > 0) bundle.$defs = defs

  assertSelfContained(bundle, family)
  return canonicalJson(bundle)
}

function conceptToDefName(concept: string): string {
  return concept
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** Refuse to emit a bundle that would make a validator reach over the network. */
function assertSelfContained(bundle: { [k: string]: Json }, family: FamilyRef): void {
  const defs = isObject(bundle.$defs) ? bundle.$defs : {}
  for (const { node } of walkObjects(bundle)) {
    const ref = node.$ref
    if (typeof ref !== 'string') continue
    if (!ref.startsWith('#/$defs/')) {
      throw new Error(`${label(family)}: bundle contains a non-local $ref — ${ref}`)
    }
    const target = decodeURIComponent(ref.slice('#/$defs/'.length))
    if (!(target in defs)) {
      throw new Error(`${label(family)}: bundle $ref ${ref} does not resolve`)
    }
  }
}

const memo = new Map<string, string | null>()

/**
 * The working tree's alias bundle, built in memory once per distinct set of
 * source bytes.
 *
 * Keyed on the bytes rather than the family, so a caller that edits a module
 * between two calls — a test, a watch loop — gets the new bundle, not a stale
 * one. Reading a handful of small files is cheap; parsing, embedding and
 * canonicalizing them on every validator compile is what is saved.
 */
export function familyBundle(family: FamilyRef): string | null {
  const repoRoot = family.repoRoot ?? REPO_ROOT
  const disk = fsReader(repoRoot)
  const src = familyPaths(family.name, family.major).src
  // Read each module once, and both key and build from those bytes: a module
  // written between hashing and building must not be cached under a key that
  // describes other bytes.
  const snapshot = new Map<string, Buffer>()
  const hash = createHash('sha256').update(`${repoRoot}\0${label(family)}\0`)
  for (const name of disk.list(src).sort()) {
    const bytes = disk.read(`${src}/${name}`)
    if (bytes === null) continue
    snapshot.set(name, bytes)
    hash.update(`${name}\0`)
    hash.update(bytes)
    hash.update('\0')
  }
  const key = hash.digest('hex')
  const cached = memo.get(key)
  if (cached !== undefined) return cached
  const reader: ModuleReader = {
    list: (dir) => (dir === src ? [...snapshot.keys()] : disk.list(dir)),
    read: (path) =>
      path.startsWith(`${src}/`) && !path.slice(src.length + 1).includes('/')
        ? (snapshot.get(path.slice(src.length + 1)) ?? null)
        : disk.read(path),
  }
  const built = buildBundle(family, { reader })
  memo.set(key, built)
  return built
}

/** A release's bundle: the same bytes as the alias but for an exact-version `$id`. */
export function pinnedBundle(
  family: FamilyRef,
  version: string,
  options: { readonly reader?: ModuleReader } = {},
): string | null {
  return buildBundle(family, { ...options, id: bundleUrl(family.name, `v${version}`) })
}

/**
 * Write a family's alias bundle to `dist/<family>/<major>/<family>.schema.json`
 * and return that absolute path, or null when no module is authored.
 *
 * For a tool that must hand another program a file. Rewrites only when the
 * bytes differ, so a CLI that caches by modification time is not invalidated
 * for nothing.
 */
export function ensureBundleFile(family: FamilyRef): string | null {
  const bundle = familyBundle(family)
  if (bundle === null) return null
  const path = inRepo(family.repoRoot ?? REPO_ROOT, familyPaths(family.name, family.major).bundle)
  let current: string | null = null
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    current = null
  }
  if (current !== bundle) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bundle, 'utf8')
  }
  return path
}

const FAMILY_ARGUMENT = /^([a-z][a-z0-9-]*)\/(v\d+)$/
const VERSION_ARGUMENT = /^(\d+)\.\d+\.\d+$/

function usage(message: string): never {
  process.stderr.write(
    `${message}\n\nUsage:\n` +
      '  bun tools/src/schema/bundle.ts\n' +
      '  bun tools/src/schema/bundle.ts --stdout <family>/<major> [--version X.Y.Z]\n',
  )
  process.exit(2)
}

function printOne(args: readonly string[]): void {
  const target = args[1]
  const match = target === undefined ? null : FAMILY_ARGUMENT.exec(target)
  if (match?.[1] === undefined || match[2] === undefined) {
    usage(`--stdout needs <family>/<major>, e.g. component/v1; got ${target ?? 'nothing'}`)
  }
  const family: FamilyRef = { name: match[1], major: match[2] }

  let version: string | undefined
  const rest = args.slice(2)
  if (rest.length > 0) {
    if (rest[0] !== '--version' || rest.length !== 2)
      usage(`unexpected arguments: ${rest.join(' ')}`)
    version = rest[1] as string
    const major = VERSION_ARGUMENT.exec(version)?.[1]
    if (major === undefined) usage(`--version must be X.Y.Z; got ${version}`)
    if (`v${major}` !== family.major) {
      usage(`--version ${version} is not in ${family.name}/${family.major}`)
    }
  }

  const bundle = version === undefined ? buildBundle(family) : pinnedBundle(family, version)
  if (bundle === null) {
    process.stderr.write(`${family.name}/${family.major}: no schema modules authored\n`)
    process.exit(1)
  }
  process.stdout.write(bundle)
}

function writeAll(): void {
  let written = 0
  // Kind families only: core has no `schemas/src` by design (docs/adr/0022),
  // and a kind family that has not authored one has nothing to say either.
  for (const family of discoverKinds()) {
    if (!family.hasSchema) continue
    const path = ensureBundleFile(family)
    if (path === null) {
      console.log(`  · ${label(family)}: no modules authored yet`)
      continue
    }
    const kb = (readFileSync(path).length / 1024).toFixed(1)
    console.log(`  ✓ ${familyPaths(family.name, family.major).bundle} (${kb} KiB)`)
    written += 1
  }

  const catalog = inRepo(REPO_ROOT, CATALOG_FILE)
  mkdirSync(dirname(catalog), { recursive: true })
  writeFileSync(catalog, canonicalJson(buildCatalog()), 'utf8')
  console.log(`  ✓ ${CATALOG_FILE}`)

  console.log(written === 0 ? 'Nothing to bundle.' : `Bundled ${written} family/families.`)
}

function main(): void {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    writeAll()
  } else if (args[0] === '--stdout') {
    printOne(args)
  } else {
    usage(`unknown argument ${args[0]}`)
  }
}

if (import.meta.main) main()
