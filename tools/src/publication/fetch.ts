/**
 * Verify every tagged release against GitHub, and cache the verified bundles —
 * `task site:fetch`, and `task check:published:online` with `--verify-only`
 * (docs/adr/0023 §4).
 *
 * For each ledger entry whose tag exists:
 *
 *   - the tags endpoint returns a published release: not a draft, immutable;
 *   - the conventional assets are present with a digest — for a kind family
 *     `<family>.schema.json` and `<family>-v<X.Y.Z>.tar.gz`, for core only the
 *     archive;
 *   - a kind family's bundle digest is `sha256:<bundleSha256>`, and the bytes
 *     downloaded hash to it too.
 *
 * Verified bundles are written to `.cache/releases/<tag>/<family>.schema.json`.
 * `site.ts` serves pinned paths from there and nowhere else. A cached bundle
 * that still hashes to the ledger skips the network for its release.
 *
 * A published release whose tag has the release pattern and no ledger entry
 * fails too: something was published outside the record.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isShallow } from '../lib/git.ts'
import { inRepo, LEDGER_FILE, RELEASE_CACHE_DIR, REPO_ROOT } from '../lib/layout.ts'
import { GitHubReleaseSource, type ReleaseSource } from './github.ts'
import { readLedger, taggedEntries } from './ledger.ts'
import { assetNames, discoverReleases, parseReleaseTag, sha256 } from './releases.ts'

export interface FetchOptions {
  /** Verify online without writing the cache, and without trusting it. */
  readonly verifyOnly?: boolean
}

export interface FetchResult {
  readonly failures: string[]
  /** Releases verified against GitHub in this run. */
  readonly verified: string[]
  /** Releases served from a cache entry that still matches the ledger. */
  readonly cached: string[]
}

const DIGEST = /^sha256:[0-9a-f]{64}$/

/** Where a release's verified bundle is cached. */
export function cachedBundlePath(cacheDir: string, tag: string): string {
  const release = parseReleaseTag(tag)
  if (release === null) throw new Error(`${tag} is not a release tag`)
  return join(cacheDir, ...tag.split('/'), assetNames(release).bundle)
}

/**
 * A release's cached bundle, if present and still hashing to `bundleSha256`.
 * Null otherwise: a cache that disagrees with the ledger is a miss, never a
 * source.
 */
export function readCachedBundle(
  cacheDir: string,
  tag: string,
  bundleSha256: string,
): Buffer | null {
  const path = cachedBundlePath(cacheDir, tag)
  if (!existsSync(path)) return null
  const bytes = readFileSync(path)
  return sha256(bytes) === bundleSha256 ? bytes : null
}

export async function fetchReleases(
  repoRoot: string,
  source: ReleaseSource,
  cacheDir: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const failures: string[] = []
  const verified: string[] = []
  const cached: string[] = []
  const ledger = readLedger(repoRoot)
  const recorded = Object.keys(ledger.releases).length

  if (recorded > 0 && discoverReleases(repoRoot).length === 0 && isShallow(repoRoot)) {
    failures.push(
      `${LEDGER_FILE} records ${recorded} release(s) but this is a shallow clone with no tags. ` +
        'Run `git fetch --tags --unshallow`.',
    )
    return { failures, verified, cached }
  }

  for (const { release, entry } of taggedEntries(repoRoot, ledger)) {
    const { tag } = release
    const names = assetNames(release)

    if (
      options.verifyOnly !== true &&
      entry.bundleSha256 !== null &&
      readCachedBundle(cacheDir, tag, entry.bundleSha256) !== null
    ) {
      cached.push(tag)
      continue
    }

    const published = await source.publishedRelease(tag)
    if (published === null) {
      failures.push(
        `${tag}: tagged and recorded, but no published GitHub release exists. The release job ` +
          `stopped between tag and publish — dispatch release.yml with tag=${tag} to recover it.`,
      )
      continue
    }
    const problems: string[] = []
    if (published.draft) problems.push('is still a draft')
    if (!published.immutable) {
      problems.push('is not immutable — enable immutable releases before publishing')
    }

    const archive = published.assets.find((asset) => asset.name === names.archive)
    if (archive === undefined) problems.push(`has no ${names.archive} asset`)
    else if (archive.digest === null || !DIGEST.test(archive.digest)) {
      problems.push(`records no sha256 digest for ${names.archive}`)
    }

    let bundle = null as (typeof published.assets)[number] | null
    if (entry.bundleSha256 !== null) {
      bundle = published.assets.find((asset) => asset.name === names.bundle) ?? null
      if (bundle === null) problems.push(`has no ${names.bundle} asset`)
      else if (bundle.digest !== `sha256:${entry.bundleSha256}`) {
        problems.push(
          `records digest ${bundle.digest ?? '<none>'} for ${names.bundle}, but ${LEDGER_FILE} ` +
            `records sha256:${entry.bundleSha256}`,
        )
      }
    }
    if (problems.length > 0) {
      for (const problem of problems) failures.push(`${tag}: the GitHub release ${problem}`)
      continue
    }

    if (bundle !== null && entry.bundleSha256 !== null) {
      const bytes = await source.download(bundle)
      const actual = sha256(bytes)
      if (actual !== entry.bundleSha256) {
        failures.push(
          `${tag}: ${names.bundle} downloaded with sha256 ${actual}, but its digest and ` +
            `${LEDGER_FILE} say ${entry.bundleSha256}`,
        )
        continue
      }
      if (options.verifyOnly !== true) {
        const path = cachedBundlePath(cacheDir, tag)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, bytes)
      }
    }
    verified.push(tag)
  }

  for (const published of await source.listReleases()) {
    if (published.draft || parseReleaseTag(published.tag) === null) continue
    if (ledger.releases[published.tag] !== undefined) continue
    failures.push(
      `${published.tag}: published on GitHub but absent from ${LEDGER_FILE}. Nothing is ` +
        'published outside the record.',
    )
  }

  return { failures, verified, cached }
}

async function main(): Promise<void> {
  const verifyOnly = process.argv.includes('--verify-only')
  const cacheDir = inRepo(REPO_ROOT, RELEASE_CACHE_DIR)
  const result = await fetchReleases(REPO_ROOT, GitHubReleaseSource.fromEnvironment(), cacheDir, {
    verifyOnly,
  })
  for (const tag of result.verified) console.log(`  ✓ ${tag} (verified on GitHub)`)
  for (const tag of result.cached) console.log(`  ✓ ${tag} (cached, matches ${LEDGER_FILE})`)
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`  ✗ ${failure}`)
    console.error(`\n${result.failures.length} problem(s) found.`)
    process.exit(1)
  }
  const total = result.verified.length + result.cached.length
  console.log(
    total === 0
      ? 'No tagged release to verify.'
      : `${total} release(s) verified${verifyOnly ? '' : `; bundles cached in ${RELEASE_CACHE_DIR}`}.`,
  )
}

if (import.meta.main) await main()
