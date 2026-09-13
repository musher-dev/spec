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
 * that still hashes to the ledger skips its download, but the release list is
 * still read, so a cache hit is served only while its release is published and
 * immutable.
 *
 * The draft window: the push that tags a release runs CI before release.yml has
 * published it. With `ALLOW_PENDING_RELEASES=1`, a tagged entry whose release
 * is absent or still a draft is a warning, recorded as pending in
 * `.cache/releases/pending.json`, and `site.ts` leaves it out of that build.
 * Without the flag — the deploy — it fails.
 *
 * A published release whose tag has the release pattern and no ledger entry
 * fails too: something was published outside the record.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isShallow } from '../lib/git.ts'
import {
  canonicalJson,
  failCli,
  inRepo,
  LEDGER_FILE,
  RELEASE_CACHE_DIR,
  REPO_ROOT,
} from '../lib/layout.ts'
import { GitHubReleaseSource, type PublishedRelease, type ReleaseSource } from './github.ts'
import { readLedger, taggedEntries } from './ledger.ts'
import { assetNames, discoverReleases, parseReleaseTag, sha256 } from './releases.ts'

export interface FetchOptions {
  /** Verify online without writing the cache, and without trusting it. */
  readonly verifyOnly?: boolean
  /**
   * The draft window: a tagged release not yet published warns and is recorded
   * as pending instead of failing. `ALLOW_PENDING_RELEASES=1` on the command line.
   */
  readonly allowPending?: boolean
}

export interface FetchResult {
  readonly failures: string[]
  /** Releases verified against GitHub in this run. */
  readonly verified: string[]
  /** Releases served from a cache entry that still matches the ledger. */
  readonly cached: string[]
  /** Tagged releases not yet published, tolerated under `allowPending`. */
  readonly pending: string[]
  readonly warnings: string[]
}

/** Where `site:fetch` records the releases it tolerated as pending. */
export const PENDING_FILE = 'pending.json'

/** Whether the environment opens the draft window. */
export function allowPendingFromEnv(
  env: { readonly [key: string]: string | undefined } = process.env,
): boolean {
  return env.ALLOW_PENDING_RELEASES === '1'
}

/** The tags the last `site:fetch` recorded as pending in a cache directory. */
export function readPendingReleases(cacheDir: string): Set<string> {
  const path = join(cacheDir, PENDING_FILE)
  if (!existsSync(path)) return new Set()
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { pending?: unknown }
  if (!Array.isArray(doc.pending) || !doc.pending.every((tag) => typeof tag === 'string')) {
    throw new Error(`${path}: expected { "pending": [<tag>, …] }`)
  }
  return new Set(doc.pending as string[])
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
  const pending: string[] = []
  const warnings: string[] = []
  const ledger = readLedger(repoRoot)
  const recorded = Object.keys(ledger.releases).length

  if (recorded > 0 && discoverReleases(repoRoot).length === 0 && isShallow(repoRoot)) {
    failures.push(
      `${LEDGER_FILE} records ${recorded} release(s) but this is a shallow clone with no tags. ` +
        'Run `git fetch --tags --unshallow`.',
    )
    return { failures, verified, cached, pending, warnings }
  }

  const listed = await source.listReleases()
  const listedByTag = new Map<string, PublishedRelease>()
  for (const release of listed) {
    // A published release wins over a stray draft for the same tag.
    const known = listedByTag.get(release.tag)
    if (known === undefined || (known.draft && !release.draft))
      listedByTag.set(release.tag, release)
  }

  /** A tagged release with no published GitHub release: pending in the draft window, else a failure. */
  const notPublished = (tag: string, state: string): void => {
    if (options.allowPending === true) {
      pending.push(tag)
      warnings.push(
        `${tag}: tagged and recorded, but its GitHub release ${state}. Pending — left out of ` +
          'this build (ALLOW_PENDING_RELEASES=1).',
      )
      return
    }
    failures.push(
      `${tag}: tagged and recorded, but its GitHub release ${state}. The release job stopped ` +
        `between tag and publish — dispatch release.yml with tag=${tag} to recover it.`,
    )
  }

  for (const { release, entry } of taggedEntries(repoRoot, ledger)) {
    const { tag } = release
    const names = assetNames(release)

    if (
      options.verifyOnly !== true &&
      entry.bundleSha256 !== null &&
      readCachedBundle(cacheDir, tag, entry.bundleSha256) !== null
    ) {
      // The bytes are verified; whether the release is still published and
      // immutable is not something a cache can remember.
      const listing = listedByTag.get(tag)
      if (listing === undefined) notPublished(tag, 'is not published')
      else if (listing.draft) notPublished(tag, 'is still a draft')
      else if (!listing.immutable) {
        failures.push(
          `${tag}: the GitHub release is not immutable — enable immutable releases before publishing`,
        )
      } else cached.push(tag)
      continue
    }

    const published = await source.publishedRelease(tag)
    if (published === null) {
      notPublished(tag, 'is not published')
      continue
    }
    if (published.draft && options.allowPending === true) {
      notPublished(tag, 'is still a draft')
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

  for (const published of listed) {
    if (published.draft || parseReleaseTag(published.tag) === null) continue
    if (ledger.releases[published.tag] !== undefined) continue
    failures.push(
      `${published.tag}: published on GitHub but absent from ${LEDGER_FILE}. Nothing is ` +
        'published outside the record.',
    )
  }

  if (options.verifyOnly !== true) {
    const path = join(cacheDir, PENDING_FILE)
    if (pending.length > 0) {
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(path, canonicalJson({ pending: [...pending].sort() }))
    } else {
      rmSync(path, { force: true })
    }
  }

  return { failures, verified, cached, pending, warnings }
}

async function main(): Promise<void> {
  const verifyOnly = process.argv.includes('--verify-only')
  const cacheDir = inRepo(REPO_ROOT, RELEASE_CACHE_DIR)
  let result: FetchResult
  try {
    result = await fetchReleases(REPO_ROOT, GitHubReleaseSource.fromEnvironment(), cacheDir, {
      verifyOnly,
      allowPending: allowPendingFromEnv(),
    })
  } catch (error) {
    // A network failure, a timeout, an API refusal, a layout the ledger does
    // not match: one line, not a stack trace.
    failCli(error)
  }
  for (const tag of result.verified) console.log(`  ✓ ${tag} (verified on GitHub)`)
  for (const tag of result.cached) console.log(`  ✓ ${tag} (cached, matches ${LEDGER_FILE})`)
  for (const warning of result.warnings) console.log(`  ! ${warning}`)
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
