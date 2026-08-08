/**
 * Compile each family's authored modules into one self-contained compound
 * schema document.
 *
 * The bundle is the artifact consumers actually fetch. Every reference resolves
 * inside `$defs`, so validation never touches the network.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  canonicalJson,
  discoverFamilies,
  type Family,
  isObject,
  type Json,
  METASCHEMA,
  readJson,
  relativeToRepo,
  rootModulePath,
  sourceModules,
  walkObjects,
} from './spec.ts'

/** Build a family's bundle in memory. Returns null when nothing is authored. */
export function buildBundle(family: Family): string | null {
  const modules = sourceModules(family)
  if (modules.length === 0) return null

  const rootPath = rootModulePath(family)
  if (!modules.includes(rootPath)) {
    throw new Error(`${family.name}/${family.major}: missing ${relativeToRepo(rootPath)}`)
  }

  const root = readJson(rootPath)
  if (!isObject(root)) {
    throw new Error(`${relativeToRepo(rootPath)}: root must be an object`)
  }

  const defs: { [k: string]: Json } = isObject(root.$defs) ? { ...root.$defs } : {}

  // Embed every non-root module as a $defs member keyed by its concept name,
  // and hoist its own $defs alongside. A 2020-12 compound schema document
  // keeps each embedded resource's $id, so identity survives the inlining.
  for (const path of modules) {
    if (path === rootPath) continue
    const doc = readJson(path)
    if (!isObject(doc)) {
      throw new Error(`${relativeToRepo(path)}: root must be an object`)
    }
    const concept = basename(path, '.schema.json')
    const key = conceptToDefName(concept)

    if (isObject(doc.$defs)) {
      for (const [name, value] of Object.entries(doc.$defs)) {
        if (name in defs) {
          throw new Error(
            `${relativeToRepo(path)}: $defs/${name} collides with an existing definition`,
          )
        }
        defs[name] = value
      }
    }

    const embedded: { [k: string]: Json } = {}
    for (const [name, value] of Object.entries(doc)) {
      if (name === '$defs' || name === '$schema') continue
      embedded[name] = value
    }
    if (key in defs) {
      throw new Error(`${relativeToRepo(path)}: $defs/${key} collides with an existing definition`)
    }
    defs[key] = embedded
  }

  const bundle: { [k: string]: Json } = {}
  for (const [name, value] of Object.entries(root)) {
    if (name === '$defs') continue
    bundle[name] = value
  }

  // The bundle's $id is its real publication URL — the file a consumer fetches.
  // Source modules carry extensionless conceptual identifiers instead; they are
  // never served on their own.
  bundle.$schema = METASCHEMA
  bundle.$id = family.bundleUrl
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
function assertSelfContained(bundle: { [k: string]: Json }, family: Family): void {
  const defs = isObject(bundle.$defs) ? bundle.$defs : {}
  for (const node of walkObjects(bundle)) {
    const ref = node.$ref
    if (typeof ref !== 'string') continue
    if (!ref.startsWith('#/$defs/')) {
      throw new Error(`${family.name}/${family.major}: bundle contains a non-local $ref — ${ref}`)
    }
    const target = decodeURIComponent(ref.slice('#/$defs/'.length))
    if (!(target in defs)) {
      throw new Error(`${family.name}/${family.major}: bundle $ref ${ref} does not resolve`)
    }
  }
}

function main(): void {
  const families = discoverFamilies()
  let written = 0

  for (const family of families) {
    const bundle = buildBundle(family)
    if (bundle === null) {
      console.log(`  · ${family.name}/${family.major}: no modules authored yet`)
      continue
    }
    mkdirSync(family.distDir, { recursive: true })
    writeFileSync(family.bundlePath, bundle, 'utf8')
    const kb = (Buffer.byteLength(bundle) / 1024).toFixed(1)
    console.log(`  ✓ ${relativeToRepo(family.bundlePath)} (${kb} KiB)`)
    written += 1
  }

  console.log(written === 0 ? 'Nothing to bundle.' : `Bundled ${written} family/families.`)
}

if (import.meta.main) main()
