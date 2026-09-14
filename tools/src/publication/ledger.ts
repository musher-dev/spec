/**
 * `published.json` — the record of every version this repository has
 * irrevocably published (docs/adr/0006, as refined by docs/adr/0023 §3).
 *
 *   {
 *     "releases": {
 *       "component/v1.0.0": {
 *         "bundleSha256": "<sha256 of the bytes served at the pinned URL>",
 *         "path": "specifications/component/v1",
 *         "requires": { "core": "1.0.0" },
 *         "tree": "<git tree id of path at the tagged commit>"
 *       },
 *       "core/v1.0.0": { "bundleSha256": null, "path": "…", "tree": "…" }
 *     },
 *     "version": 2
 *   }
 *
 * The ledger answers what git alone cannot: whether a missing tag means "never
 * fetched" or "never released", where each release lived, which bytes its
 * pinned URL serves, and which core edition a kind family was built against.
 *
 * Entries are written on the release pull request by `record.ts`, and only
 * ever grow: `check` fails a removal or an edit against the base branch.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readFileSync } from 'node:fs'
import { assertCommit, readBlobAtRef, tagExists } from '../lib/git.ts'
import {
  canonicalJson,
  Failures,
  inRepo,
  isObject,
  type Json,
  LEDGER_FILE,
  REPO_ROOT,
} from '../lib/layout.ts'
import { compareReleases, isCore, isVersion, parseReleaseTag, type Release } from './releases.ts'

export { LEDGER_FILE }

/** One recorded release. */
export interface LedgerEntry {
  /** Repo-relative family version directory the release was cut from. */
  readonly path: string
  /** Git's tree id for `path` at the tagged commit. */
  readonly tree: string
  /** SHA-256 of the bytes served at the pinned schema URL. Null exactly for core. */
  readonly bundleSha256: string | null
  /** Exact versions this release was built against. Present exactly when not core. */
  readonly requires?: { readonly core: string }
}

export interface Ledger {
  readonly version: 2
  readonly releases: { readonly [tag: string]: LedgerEntry }
}

/** A base branch's ledger, which may predate version 2. Only its emptiness matters then. */
export type AnyLedger = Ledger | { readonly version: 1; readonly releases: { [tag: string]: Json } }

export const EMPTY_LEDGER: Ledger = { version: 2, releases: {} }

const TREE_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const SHA256 = /^[0-9a-f]{64}$/
const REPO_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/
const ENTRY_KEYS = new Set(['path', 'tree', 'bundleSha256', 'requires'])

/**
 * Validate a parsed ledger document, adding one failure per problem. Returns the
 * ledger when it is well formed, and null otherwise.
 *
 * The field rules are docs/adr/0023 §3: `bundleSha256` is null if and only if
 * the family is core, and `requires` is present if and only if it is not.
 */
export function validateLedger(
  doc: Json,
  failures: Failures,
  source: string = LEDGER_FILE,
): Ledger | null {
  const before = failures.count
  if (!isObject(doc)) {
    failures.add(`${source}: expected { "version": 2, "releases": { … } }`)
    return null
  }
  if (doc.version !== 2) {
    failures.add(`${source}: "version" must be 2, found ${JSON.stringify(doc.version ?? null)}`)
  }
  for (const key of Object.keys(doc)) {
    if (key !== 'version' && key !== 'releases') failures.add(`${source}: unknown key "${key}"`)
  }
  if (!isObject(doc.releases)) {
    failures.add(`${source}: "releases" must be an object keyed by release tag`)
    return null
  }

  const releases: { [tag: string]: LedgerEntry } = {}
  for (const [tag, value] of Object.entries(doc.releases)) {
    const where = `${source}: releases/${tag}`
    const release = parseReleaseTag(tag)
    if (release === null) {
      failures.add(`${where}: not a release tag (<family>/v<MAJOR>.<MINOR>.<PATCH>)`)
      continue
    }
    if (!isObject(value)) {
      failures.add(`${where}: must be an object`)
      continue
    }
    for (const key of Object.keys(value)) {
      if (!ENTRY_KEYS.has(key)) failures.add(`${where}: unknown field "${key}"`)
    }
    const { path, tree, bundleSha256, requires } = value
    if (typeof path !== 'string' || !REPO_PATH.test(path)) {
      failures.add(`${where}: "path" must be a repo-relative directory`)
    }
    if (typeof tree !== 'string' || !TREE_ID.test(tree)) {
      failures.add(`${where}: "tree" must be a git tree id`)
    }
    if (isCore(release.family)) {
      if (bundleSha256 !== null) {
        failures.add(`${where}: core publishes no schema, so "bundleSha256" must be null`)
      }
      if (requires !== undefined) {
        failures.add(`${where}: core requires nothing, so "requires" must be absent`)
      }
    } else {
      if (typeof bundleSha256 !== 'string' || !SHA256.test(bundleSha256)) {
        failures.add(`${where}: a kind family's "bundleSha256" must be a sha256 hex digest`)
      }
      if (!isObject(requires)) {
        failures.add(`${where}: a kind family must record "requires": { "core": "X.Y.Z" }`)
      } else {
        for (const key of Object.keys(requires)) {
          if (key !== 'core') failures.add(`${where}: "requires" names unknown family "${key}"`)
        }
        if (typeof requires.core !== 'string' || !isVersion(requires.core)) {
          failures.add(`${where}: "requires.core" must be an exact X.Y.Z version`)
        }
      }
    }
    if (failures.count > before) continue
    releases[tag] = {
      path: path as string,
      tree: tree as string,
      bundleSha256: bundleSha256 as string | null,
      ...(isCore(release.family)
        ? {}
        : { requires: { core: (requires as { core: string }).core } }),
    }
  }
  return failures.count > before ? null : { version: 2, releases }
}

/** Parse ledger text, throwing every problem at once. */
export function parseLedger(text: string, source: string = LEDGER_FILE): Ledger {
  let doc: Json
  try {
    doc = JSON.parse(text) as Json
  } catch (error) {
    throw new Error(`${source}: not JSON — ${(error as Error).message}`)
  }
  const failures = new Failures()
  const ledger = validateLedger(doc, failures, source)
  if (ledger === null) throw new Error(failures.messages.join('\n'))
  return ledger
}

/** The working tree's ledger. An absent file is an empty ledger. */
export function readLedger(repoRoot: string): Ledger {
  const path = inRepo(repoRoot, LEDGER_FILE)
  if (!existsSync(path)) return EMPTY_LEDGER
  return parseLedger(readFileSync(path, 'utf8'))
}

/** Canonical JSON: sorted tags, sorted fields, `requires` only where it exists. */
export function serializeLedger(ledger: Ledger): string {
  const releases: { [tag: string]: Json } = {}
  for (const tag of Object.keys(ledger.releases).sort()) {
    const entry = ledger.releases[tag] as LedgerEntry
    releases[tag] = {
      path: entry.path,
      tree: entry.tree,
      bundleSha256: entry.bundleSha256,
      ...(entry.requires === undefined ? {} : { requires: { core: entry.requires.core } }),
    }
  }
  return canonicalJson({ version: 2, releases })
}

/** Whether two entries record the same release. */
export function sameEntry(a: LedgerEntry, b: LedgerEntry): boolean {
  return (
    a.path === b.path &&
    a.tree === b.tree &&
    a.bundleSha256 === b.bundleSha256 &&
    a.requires?.core === b.requires?.core &&
    (a.requires === undefined) === (b.requires === undefined)
  )
}

/**
 * The ledger as of a git ref. Absent there is empty; a version 1 ledger comes
 * back as such, for the one comparison that accepts it.
 *
 * The ref itself must resolve, so a base branch that was never fetched fails
 * rather than reading as "nothing was ever published".
 */
export function ledgerAtRef(repoRoot: string, ref: string): AnyLedger {
  assertCommit(repoRoot, ref)
  const blob = readBlobAtRef(repoRoot, ref, LEDGER_FILE)
  if (blob === null) return EMPTY_LEDGER
  const source = `${ref}:${LEDGER_FILE}`
  const text = blob.toString('utf8')
  const doc = JSON.parse(text) as Json
  if (isObject(doc) && doc.version === 1) {
    if (!isObject(doc.releases)) throw new Error(`${source}: version 1 ledger has no "releases"`)
    return { version: 1, releases: doc.releases }
  }
  return parseLedger(text, source)
}

/**
 * The ledger only ever grows. Removing or editing an entry is the paper form of
 * unpublishing a released version, so it fails the build rather than the review.
 *
 * The one rewrite allowed is version 1 to version 2, and only from an empty
 * version 1 ledger: nothing was published under the old shape, so nothing is
 * lost (docs/adr/0023 §3).
 */
export function assertAppendOnly(base: AnyLedger, head: Ledger, failures: Failures): void {
  if (base.version === 1) {
    const recorded = Object.keys(base.releases)
    if (recorded.length > 0) {
      failures.add(
        `${LEDGER_FILE}: the base ledger is version 1 and records ${recorded.join(', ')}. ` +
          'Only an empty version 1 ledger may be rewritten as version 2.',
      )
    }
    return
  }
  for (const [tag, entry] of Object.entries(base.releases)) {
    const now = head.releases[tag]
    if (now === undefined) {
      failures.add(`${LEDGER_FILE}: ${tag} was removed. Released versions cannot be unpublished.`)
      continue
    }
    if (!sameEntry(entry, now)) {
      failures.add(
        `${LEDGER_FILE}: ${tag} was modified. A recorded release is immutable — ` +
          'supersede it with a new version instead.',
      )
    }
  }
}

export interface RecordedRelease {
  readonly release: Release
  readonly entry: LedgerEntry
}

/**
 * Every ledger entry whose tag exists, in release order. An entry with no tag is
 * pending — a release pull request mid-flight — and is not yet served.
 */
export function taggedEntries(repoRoot: string, ledger: Ledger): RecordedRelease[] {
  const found: RecordedRelease[] = []
  for (const [tag, entry] of Object.entries(ledger.releases)) {
    const release = parseReleaseTag(tag)
    if (release === null || !tagExists(repoRoot, tag)) continue
    found.push({ release, entry })
  }
  return found.sort((a, b) => compareReleases(a.release, b.release))
}

function main(): void {
  const command = process.argv[2] ?? 'check'

  if (command === 'check') {
    const baseRef = process.env.BASE_REF
    if (baseRef === undefined || baseRef === '') {
      // Still parse the head ledger: a malformed file must not pass for want of a base.
      readLedger(REPO_ROOT)
      console.log('BASE_REF not set — skipping the append-only comparison.')
      return
    }
    const failures = new Failures()
    assertAppendOnly(ledgerAtRef(REPO_ROOT, baseRef), readLedger(REPO_ROOT), failures)
    failures.report(`${LEDGER_FILE} is append-only against ${baseRef}.`)
    return
  }

  if (command === 'has-tagged') {
    // Exit status only, for a Taskfile `if:` — 0 when some entry is tagged.
    process.exit(taggedEntries(REPO_ROOT, readLedger(REPO_ROOT)).length > 0 ? 0 : 1)
  }

  console.error(`Unknown command "${command}". Expected check or has-tagged.`)
  process.exit(1)
}

if (import.meta.main) main()
