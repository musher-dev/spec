/**
 * Record pending releases in `published.json` — `task release:record`.
 *
 * Runs on a release-please pull request branch, before the tag exists.
 * `.github/rulesets/main-branch.json` allows only squash merges of an
 * up-to-date branch, so the merge commit's tree is the head's tree and an entry
 * written here describes the commit that gets tagged (docs/adr/0023 §3).
 *
 * For each manifest version that is not tagged it writes `path`, `tree` (git's
 * tree id of the family version directory at HEAD), `bundleSha256` (the pinned
 * bundle built from HEAD, null for core) and, for a kind family,
 * `requires.core` (core's manifest version). It inserts or updates such pending
 * entries — a branch updated from `main` is re-recorded, not left stale — and
 * never rewrites an entry whose tag exists.
 *
 * The core gate runs before anything is written.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isDirty, listTreeFiles, tagExists, treeId } from '../lib/git.ts'
import {
  Failures,
  inRepo,
  LEDGER_FILE,
  parseManifestKey,
  REPO_ROOT,
  releaseDirPaths,
} from '../lib/layout.ts'
import { pinnedBundle } from '../schema/bundle.ts'
import { gitReader } from '../schema/sources.ts'
import {
  assertCoreGatePending,
  coreManifestVersionFor,
  type PendingKindRelease,
} from './core-gate.ts'
import { type LedgerEntry, readLedger, sameEntry, serializeLedger } from './ledger.ts'
import {
  isCore,
  parseReleaseTag,
  readManifest,
  releaseTag,
  sha256,
  UNRELEASED_VERSION,
} from './releases.ts'

export interface RecordResult {
  /** Entries added. */
  readonly recorded: string[]
  /** Pending entries whose fields changed. */
  readonly updated: string[]
  /** Pending entries dropped because their manifest moved to another version. */
  readonly dropped: string[]
  readonly changed: boolean
  readonly warnings: string[]
}

/** The core gate refused, or HEAD cannot be recorded. Nothing was written. */
export class RecordError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'RecordError'
  }
}

export function record(repoRoot: string): RecordResult {
  const manifest = readManifest(repoRoot)
  const ledger = readLedger(repoRoot)
  const releases: { [tag: string]: LedgerEntry } = { ...ledger.releases }
  const result = { recorded: [] as string[], updated: [] as string[], dropped: [] as string[] }
  const problems: string[] = []
  const gated: PendingKindRelease[] = []

  for (const [key, version] of Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))) {
    const parsed = parseManifestKey(key)
    if (parsed === null || version === UNRELEASED_VERSION) continue
    const tag = releaseTag(parsed.name, version)
    if (tagExists(repoRoot, tag)) continue

    // A release branch rewritten to another version leaves the old pending
    // entry behind. It was never tagged and is not on the base branch, so
    // dropping it unpublishes nothing.
    for (const [other, entry] of Object.entries(releases)) {
      if (other === tag || entry.path !== key || tagExists(repoRoot, other)) continue
      delete releases[other]
      result.dropped.push(other)
    }

    // The entry describes HEAD, so the directory must be HEAD.
    if (isDirty(repoRoot, key)) {
      problems.push(`${tag}: ${key} has uncommitted changes. Commit them, then record.`)
      continue
    }
    const tree = treeId(repoRoot, 'HEAD', key)
    if (tree === null) {
      problems.push(`${tag}: ${key} does not exist at HEAD`)
      continue
    }

    let entry: LedgerEntry
    if (isCore(parsed.name)) {
      if (listTreeFiles(repoRoot, 'HEAD', releaseDirPaths(key).src).length > 0) {
        problems.push(`${tag}: core publishes no schema, but ${releaseDirPaths(key).src} exists`)
        continue
      }
      entry = { path: key, tree, bundleSha256: null }
    } else {
      const bundle = pinnedBundle({ name: parsed.name, major: parsed.major, repoRoot }, version, {
        reader: gitReader(repoRoot, 'HEAD'),
      })
      if (bundle === null) {
        problems.push(`${tag}: ${releaseDirPaths(key).src} has no schema modules at HEAD`)
        continue
      }
      const core = coreManifestVersionFor(repoRoot, key) ?? UNRELEASED_VERSION
      entry = { path: key, tree, bundleSha256: sha256(bundle), requires: { core } }
      gated.push({ tag, path: key, requiresCore: core })
    }

    const previous = releases[tag]
    if (previous === undefined) result.recorded.push(tag)
    else if (!sameEntry(previous, entry)) result.updated.push(tag)
    releases[tag] = entry
  }

  const failures = new Failures()
  const warnings: string[] = []
  assertCoreGatePending(repoRoot, failures, warnings, gated)
  problems.push(...failures.messages)
  if (problems.length > 0) throw new RecordError(problems)

  const path = inRepo(repoRoot, LEDGER_FILE)
  const next = serializeLedger({ version: 2, releases })
  const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const changed = current !== next
  if (changed) writeFileSync(path, next, 'utf8')
  return { ...result, changed, warnings }
}

function main(): void {
  let result: RecordResult
  try {
    result = record(REPO_ROOT)
  } catch (error) {
    if (!(error instanceof RecordError)) throw error
    for (const problem of error.problems) console.error(`  ✗ ${problem}`)
    console.error(`\n${error.problems.length} problem(s) found. ${LEDGER_FILE} was not changed.`)
    process.exit(1)
  }
  for (const tag of result.recorded) console.log(`  ✓ recorded ${tag}`)
  for (const tag of result.updated) console.log(`  ✓ updated ${tag}`)
  for (const tag of result.dropped) {
    const release = parseReleaseTag(tag)
    console.log(`  · dropped ${tag}${release === null ? '' : ' — its manifest moved on'}`)
  }
  for (const warning of result.warnings) console.log(`  ! ${warning}`)
  console.log(result.changed ? `${LEDGER_FILE} updated.` : `${LEDGER_FILE} already current.`)
}

if (import.meta.main) main()
