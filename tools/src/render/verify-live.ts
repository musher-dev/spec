/**
 * Check what the origin actually serves after a deploy — `task site:verify-live`
 * (docs/adr/0023 §4).
 *
 * For every tagged kind family release it GETs the pinned bundle and its
 * `.sha256` sidecar and compares them with the ledger's `bundleSha256`. For
 * every released major it GETs the alias and compares it with the newest
 * pinned bundle restamped with the alias `$id`; for an unreleased major, with
 * the bundle built from the working tree the deploy was built from.
 *
 * A fresh deploy can take a moment to reach the edge, so each URL is retried
 * before it counts as a failure.
 *
 * The origin defaults to https://specifications.musher.dev; `--origin=<url>` or
 * `SITE_ORIGIN` overrides it, e.g. for a preview deployment.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { discoverKinds, REPO_ROOT, SCHEMA_ORIGIN } from '../lib/layout.ts'
import type { FetchLike } from '../publication/github.ts'
import { readLedger, taggedEntries } from '../publication/ledger.ts'
import { aliasUrl, assetNames, pinnedUrl, sha256, stampId } from '../publication/releases.ts'
import { familyBundle } from '../schema/bundle.ts'

export interface LiveOptions {
  readonly origin?: string
  readonly fetch?: FetchLike
  /** Attempts per URL before it fails. */
  readonly attempts?: number
  readonly delayMs?: number
}

export interface LiveResult {
  readonly failures: string[]
  readonly checked: string[]
}

interface Expectation {
  readonly url: string
  readonly sha256: string
  /** What the expected hash is, for the message. */
  readonly source: string
}

function onOrigin(origin: string, canonical: string): string {
  return `${origin.replace(/\/$/, '')}${new URL(canonical).pathname}`
}

export async function verifyLive(repoRoot: string, options: LiveOptions = {}): Promise<LiveResult> {
  const origin = options.origin ?? SCHEMA_ORIGIN
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init))
  const attempts = Math.max(1, options.attempts ?? 5)
  const delayMs = options.delayMs ?? 10_000
  const failures: string[] = []
  const checked: string[] = []

  /** GET with retries until the body hashes to `sha256`. Returns the last body seen, or null. */
  const check = async (expected: Expectation): Promise<Buffer | null> => {
    let last = 'not requested'
    let body: Buffer | null = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1 && delayMs > 0) await Bun.sleep(delayMs)
      try {
        const response = await doFetch(expected.url, {
          headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'musher-specifications-tools' },
        })
        if (!response.ok) {
          last = `HTTP ${response.status}`
          continue
        }
        body = Buffer.from(await response.arrayBuffer())
        const actual = sha256(body)
        if (actual === expected.sha256) {
          checked.push(expected.url)
          return body
        }
        last = `sha256 ${actual}`
      } catch (error) {
        last = (error as Error).message
      }
    }
    failures.push(
      `${expected.url}: expected sha256 ${expected.sha256} (${expected.source}), got ${last} ` +
        `after ${attempts} attempt(s)`,
    )
    return null
  }

  const newest = new Map<string, { family: string; major: string; pinned: Buffer }>()
  for (const { release, entry } of taggedEntries(repoRoot, readLedger(repoRoot))) {
    if (entry.bundleSha256 === null) continue
    const url = onOrigin(origin, pinnedUrl(release))
    const pinned = await check({ url, sha256: entry.bundleSha256, source: `ledger ${release.tag}` })
    const sidecar = `${entry.bundleSha256}  ${assetNames(release).bundle}\n`
    await check({ url: `${url}.sha256`, sha256: sha256(sidecar), source: 'sha256sum sidecar' })
    // Oldest first, so the last verified release per major is the newest.
    const key = `${release.family}/${release.major}`
    if (pinned !== null) newest.set(key, { family: release.family, major: release.major, pinned })
    else newest.delete(key)
  }

  for (const { family, major, pinned } of newest.values()) {
    const alias = aliasUrl(family, major)
    await check({
      url: onOrigin(origin, alias),
      sha256: sha256(stampId(pinned, alias)),
      source: 'newest pinned bundle restamped',
    })
  }

  const released = new Set(
    taggedEntries(repoRoot, readLedger(repoRoot)).map(
      ({ release }) => `${release.family}/${release.major}`,
    ),
  )
  for (const family of discoverKinds(repoRoot)) {
    if (!family.hasSchema || released.has(`${family.name}/${family.major}`)) continue
    const bundle = familyBundle(family)
    if (bundle === null) continue
    await check({
      url: onOrigin(origin, aliasUrl(family.name, family.major)),
      sha256: sha256(bundle),
      source: 'working tree build',
    })
  }

  return { failures, checked }
}

async function main(): Promise<void> {
  const flag = process.argv.find((arg) => arg.startsWith('--origin='))
  const origin = flag?.slice('--origin='.length) || process.env.SITE_ORIGIN || SCHEMA_ORIGIN
  const result = await verifyLive(REPO_ROOT, { origin })
  for (const url of result.checked) console.log(`  ✓ ${url}`)
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`  ✗ ${failure}`)
    console.error(`\n${result.failures.length} problem(s) found on ${origin}.`)
    process.exit(1)
  }
  console.log(`${result.checked.length} URL(s) on ${origin} serve the recorded bytes.`)
}

if (import.meta.main) await main()
