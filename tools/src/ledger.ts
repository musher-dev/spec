/**
 * Maintain `published.json` — the record of every version this repository has
 * irrevocably published.
 *
 * `record` runs on a release-please pull request branch, before the tag exists.
 * That placement is deliberate. `.github/rulesets/main-branch.json` allows only
 * squash merges and sets `strict_required_status_checks_policy`, so a release
 * branch cannot merge while it is behind `main`. An entry written there is
 * therefore guaranteed to describe the bundle in the very commit that gets
 * tagged, with no window in which `main` moves underneath it — which is what
 * lets `check:published` treat a tag with no ledger entry as a hard failure
 * rather than something to tolerate for a while after each release.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.ts'
import {
  defaultBundlePath,
  discoverReleases,
  EMPTY_LEDGER,
  LEDGER_FILE,
  type Ledger,
  type LedgerEntry,
  loadRelease,
  MANIFEST_FILE,
  parseReleaseTag,
  readLedger,
  serializeLedger,
  sha256,
  stampPinnedId,
} from './released.ts'
import { Failures, isObject, REPO_ROOT, readJson } from './spec.ts'

function ledgerPath(repoRoot: string): string {
  return join(repoRoot, LEDGER_FILE)
}

function save(repoRoot: string, ledger: Ledger): boolean {
  const path = ledgerPath(repoRoot)
  const next = serializeLedger(ledger)
  const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (current === next) return false
  writeFileSync(path, next, 'utf8')
  return true
}

/**
 * Record the version each family's manifest declares, if it is not already in.
 *
 * Idempotent: a re-run after release-please rewrites its branch picks up the
 * new manifest version and leaves everything else alone.
 */
export function record(repoRoot: string): { added: string[]; changed: boolean } {
  const manifestPath = join(repoRoot, MANIFEST_FILE)
  if (!existsSync(manifestPath)) return { added: [], changed: false }
  const manifest = readJson(manifestPath)
  if (!isObject(manifest)) return { added: [], changed: false }

  const ledger = readLedger(repoRoot)
  const releases = { ...ledger.releases }
  const added: string[] = []

  for (const [key, version] of Object.entries(manifest)) {
    if (typeof version !== 'string' || version === '0.0.0') continue
    const parts = key.split('/')
    const family = parts[1]
    const major = parts[2]
    if (family === undefined || major === undefined) continue

    const tag = `${family}/v${version}`
    if (releases[tag] !== undefined) continue

    const release = parseReleaseTag(tag)
    if (release === null) continue

    const path = defaultBundlePath(family, major)
    const absolute = join(repoRoot, path)
    if (!existsSync(absolute)) {
      throw new Error(`${tag}: cannot record — ${path} does not exist`)
    }
    const source = readFileSync(absolute)
    releases[tag] = {
      path,
      sourceSha256: sha256(source),
      publishedSha256: sha256(stampPinnedId(source, release)),
    }
    added.push(tag)
  }

  const changed = save(repoRoot, { version: 1, releases })
  return { added, changed }
}

/** Backfill entries for tags that exist but were never recorded. An escape hatch. */
export function sync(repoRoot: string): { added: string[]; changed: boolean } {
  const ledger = readLedger(repoRoot)
  const releases = { ...ledger.releases }
  const added: string[] = []

  for (const release of discoverReleases(repoRoot)) {
    if (releases[release.tag] !== undefined) continue
    const loaded = loadRelease(repoRoot, release, ledger)
    releases[release.tag] = {
      path: loaded.path,
      sourceSha256: loaded.sourceSha256,
      publishedSha256: loaded.publishedSha256,
    }
    added.push(release.tag)
  }

  const changed = save(repoRoot, { version: 1, releases })
  return { added, changed }
}

function sameEntry(a: LedgerEntry, b: LedgerEntry): boolean {
  return (
    a.path === b.path &&
    a.sourceSha256 === b.sourceSha256 &&
    a.publishedSha256 === b.publishedSha256
  )
}

/**
 * The ledger only ever grows. Removing or editing an entry is the paper form of
 * unpublishing a released version, so it fails the build rather than the review.
 */
export function assertAppendOnly(base: Ledger, head: Ledger, failures: Failures): void {
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

/** Read the ledger as of a git ref, for the append-only comparison. */
function ledgerAtRef(repoRoot: string, ref: string): Ledger {
  try {
    const raw = git(repoRoot, ['show', `${ref}:${LEDGER_FILE}`])
    const doc = JSON.parse(raw) as unknown
    if (!isObject(doc as never) || !isObject((doc as { releases?: never }).releases as never)) {
      return EMPTY_LEDGER
    }
    return doc as unknown as Ledger
  } catch {
    // No ledger at that ref — the file is new, which is an addition.
    return EMPTY_LEDGER
  }
}

function main(): void {
  const command = process.argv[2] ?? 'check'

  if (command === 'record' || command === 'sync') {
    const run = command === 'record' ? record : sync
    const { added, changed } = run(REPO_ROOT)
    for (const tag of added) console.log(`  ✓ recorded ${tag}`)
    console.log(changed ? `${LEDGER_FILE} updated.` : `${LEDGER_FILE} already current.`)
    return
  }

  if (command === 'check') {
    const baseRef = process.env.BASE_REF
    if (baseRef === undefined || baseRef === '') {
      console.log('BASE_REF not set — skipping the append-only comparison.')
      return
    }
    const failures = new Failures()
    assertAppendOnly(ledgerAtRef(REPO_ROOT, baseRef), readLedger(REPO_ROOT), failures)
    failures.report(`${LEDGER_FILE} is append-only against ${baseRef}.`)
    return
  }

  console.error(`Unknown command "${command}". Expected record, sync, or check.`)
  process.exit(1)
}

if (import.meta.main) main()
