/**
 * Verify what this repository claims to have published, offline, against git —
 * `task check:published` (docs/adr/0023 §4).
 *
 *   entry + tag     `<tag>:<path>` must have the recorded tree id, and the tag's
 *                   own ledger must hold the same entry. Kind families also pass
 *                   the tagged core gate. Nothing is rebuilt: a released version
 *                   is never re-derived by newer tooling. Its bytes are checked
 *                   online, against the immutable release asset, by `fetch.ts`.
 *   entry, no tag   a release pull request mid-flight. The manifest must name
 *                   the version, `tree` must equal `HEAD:<path>`, the pinned
 *                   bundle built from the working tree must hash to
 *                   `bundleSha256`, and the pending core gate must pass.
 *   tag, no entry   a tag created outside the release flow. Always a failure.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isDirty, isEmptyRepository, isShallow, tagExists, treeId } from '../lib/git.ts'
import {
  Failures,
  familyPaths,
  inRepo,
  type Json,
  LEDGER_FILE,
  parseManifestKey,
  RELEASE_PLEASE_MANIFEST_FILE,
  REPO_ROOT,
  releaseDirPaths,
} from '../lib/layout.ts'
import { pinnedBundle } from '../schema/bundle.ts'
import { assertCoreGatePending, assertCoreGateTagged } from './core-gate.ts'
import { type Ledger, ledgerAtRef, readLedger, sameEntry, validateLedger } from './ledger.ts'
import {
  discoverReleases,
  isCore,
  parseReleaseTag,
  readManifest,
  releaseTag,
  sha256,
  UNRELEASED_VERSION,
} from './releases.ts'

function loadLedger(repoRoot: string, failures: Failures): Ledger | null {
  const path = inRepo(repoRoot, LEDGER_FILE)
  if (!existsSync(path)) return { version: 2, releases: {} }
  let doc: Json
  try {
    doc = JSON.parse(readFileSync(path, 'utf8')) as Json
  } catch (error) {
    failures.add(`${LEDGER_FILE}: not JSON — ${(error as Error).message}`)
    return null
  }
  return validateLedger(doc, failures)
}

export function verifyPublications(
  repoRoot: string,
  failures: Failures,
  warnings: string[] = [],
): void {
  if (isEmptyRepository(repoRoot)) return
  const ledger = loadLedger(repoRoot, failures)
  if (ledger === null) return

  const tags = discoverReleases(repoRoot)
  const recorded = Object.keys(ledger.releases)
  if (recorded.length > 0 && tags.length === 0 && isShallow(repoRoot)) {
    failures.add(
      `${LEDGER_FILE} records ${recorded.length} release(s) but this is a shallow clone with ` +
        'no tags. Run `git fetch --tags --unshallow` — publishing from here would drop every ' +
        'pinned version.',
    )
    return
  }

  const manifest = readManifest(repoRoot)
  const pendingKinds: { tag: string; path: string; requiresCore: string }[] = []

  for (const [tag, entry] of Object.entries(ledger.releases)) {
    const release = parseReleaseTag(tag)
    if (release === null) continue // validateLedger already refused it

    if (tagExists(repoRoot, tag)) {
      const tree = treeId(repoRoot, tag, entry.path)
      if (tree === null) {
        failures.add(`${tag}: ${entry.path} does not exist at that tag`)
        continue
      }
      if (tree !== entry.tree) {
        failures.add(
          `${tag}: ${entry.path} has tree ${tree}, but ${LEDGER_FILE} records ${entry.tree}. ` +
            'A released version has been altered — the tag was rewritten or the ledger edited.',
        )
        continue
      }
      const atTag = ledgerAtRef(repoRoot, tag)
      const own = atTag.version === 2 ? atTag.releases[tag] : undefined
      if (own === undefined) {
        failures.add(
          `${tag}: the tag's own ${LEDGER_FILE} does not record it. An entry is written on the ` +
            'release pull request, so the tagged commit carries it.',
        )
        continue
      }
      if (!sameEntry(own, entry)) {
        failures.add(`${tag}: the entry differs from the one in the tag's own ${LEDGER_FILE}`)
        continue
      }
      if (entry.requires !== undefined) {
        assertCoreGateTagged(repoRoot, tag, entry.requires.core, failures, entry.path)
      }
      continue
    }

    // Pending. The tag does not exist yet, so HEAD is the only place the release
    // can be, and the manifest is what says it is the one about to be tagged.
    const declared = manifest[entry.path]
    if (declared !== release.version) {
      failures.add(
        `${LEDGER_FILE}: ${tag} has no tag and ${RELEASE_PLEASE_MANIFEST_FILE} reads ` +
          `${declared ?? '<absent>'} for ${entry.path}. A ledger entry without a tag is only ` +
          'valid while its release is pending.',
      )
      continue
    }
    const expectedDir = familyPaths(release.family, release.major).dir
    if (entry.path !== expectedDir) {
      failures.add(
        `${tag}: pending at ${entry.path}, but this tooling builds it from ${expectedDir}`,
      )
      continue
    }
    const head = treeId(repoRoot, 'HEAD', entry.path)
    if (head === null) {
      failures.add(`${tag}: ${entry.path} does not exist at HEAD`)
      continue
    }
    if (head !== entry.tree) {
      failures.add(
        `${tag}: ${entry.path} has tree ${head} at HEAD, but ${LEDGER_FILE} records ` +
          `${entry.tree}. Re-run \`task release:record\`.`,
      )
    }
    if (isDirty(repoRoot, entry.path)) {
      warnings.push(`${tag}: ${entry.path} has uncommitted changes; verified the working tree`)
    }
    if (isCore(release.family)) {
      if (existsSync(inRepo(repoRoot, releaseDirPaths(entry.path).src))) {
        failures.add(
          `${tag}: core publishes no schema, but ${releaseDirPaths(entry.path).src} exists`,
        )
      }
      continue
    }
    const bundle = pinnedBundle(
      { name: release.family, major: release.major, repoRoot },
      release.version,
    )
    if (bundle === null) {
      failures.add(`${tag}: pending, but ${releaseDirPaths(entry.path).src} has no schema modules`)
      continue
    }
    const actual = sha256(bundle)
    if (actual !== entry.bundleSha256) {
      failures.add(
        `${tag}: records bundleSha256 ${entry.bundleSha256}, but the pinned bundle built from ` +
          `${entry.path} hashes to ${actual}. Re-run \`task release:record\`.`,
      )
    }
    if (entry.requires !== undefined) {
      pendingKinds.push({ tag, path: entry.path, requiresCore: entry.requires.core })
    }
  }
  assertCoreGatePending(repoRoot, failures, warnings, pendingKinds)

  for (const release of tags) {
    if (ledger.releases[release.tag] !== undefined) continue
    failures.add(
      `${release.tag} is tagged but absent from ${LEDGER_FILE}. Every published version is ` +
        'recorded on its release pull request before it is tagged.',
    )
  }
}

/** A manifest version that is neither tagged nor recorded — worth saying, not failing. */
export function pendingNotices(repoRoot: string): string[] {
  if (isEmptyRepository(repoRoot)) return []
  const ledger = readLedger(repoRoot)
  const notices: string[] = []
  for (const [key, version] of Object.entries(readManifest(repoRoot))) {
    if (version === UNRELEASED_VERSION) continue
    const family = parseManifestKey(key)?.name
    if (family === undefined) continue
    const tag = releaseTag(family, version)
    if (ledger.releases[tag] !== undefined || tagExists(repoRoot, tag)) continue
    notices.push(`${key} reads ${version}, which is neither tagged nor recorded yet`)
  }
  return notices
}

function main(): void {
  const failures = new Failures()
  const warnings: string[] = []
  verifyPublications(REPO_ROOT, failures, warnings)
  for (const notice of pendingNotices(REPO_ROOT)) console.log(`  · ${notice}`)
  for (const warning of warnings) console.log(`  ! ${warning}`)

  const ledger = failures.count === 0 ? readLedger(REPO_ROOT) : { releases: {} }
  const recorded = Object.keys(ledger.releases)
  const tagged = recorded.filter((tag) => tagExists(REPO_ROOT, tag)).length
  const pending = recorded.length - tagged
  const parts: string[] = []
  if (tagged > 0) parts.push(`${tagged} published version(s)`)
  if (pending > 0) parts.push(`${pending} pending release(s)`)
  failures.report(
    parts.length === 0
      ? `Nothing released or pending — ${LEDGER_FILE} is empty.`
      : `Verified ${parts.join(' and ')} against ${LEDGER_FILE} and git.`,
  )
}

if (import.meta.main) main()
