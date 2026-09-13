/**
 * `site:fetch` refuses every way a GitHub release can fail to be the bytes the
 * ledger pins, and a verified cache spares the network.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { FixtureRepo } from '../testing/fixture.ts'
import { Pipeline } from '../testing/pipeline.ts'
import { FakeReleaseSource } from '../testing/release-source.ts'
import { cachedBundlePath, fetchReleases, readCachedBundle } from './fetch.ts'
import { readLedger } from './ledger.ts'
import { stageRelease } from './stage.ts'

const TAG = 'component/v1.0.0'
const BUNDLE = 'component.schema.json'
const ARCHIVE = 'component-v1.0.0.tar.gz'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

function released(): { fx: FixtureRepo; p: Pipeline; sha: string } {
  const fx = new FixtureRepo()
  repo = fx
  const p = new Pipeline(fx)
  p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
  const sha = readLedger(fx.root).releases[TAG]?.bundleSha256 as string
  return { fx, p, sha }
}

async function failures(p: Pipeline, options = {}): Promise<string[]> {
  return (await fetchReleases(p.fx.root, p.source, p.cacheDir, options)).failures
}

describe('fetchReleases', () => {
  test('verifies every tagged release and caches the kind family bundle', async () => {
    const { p, sha } = released()
    const result = await fetchReleases(p.fx.root, p.source, p.cacheDir)
    expect(result).toEqual({
      failures: [],
      verified: ['component/v1.0.0', 'core/v1.0.0'],
      cached: [],
    })
    expect(readCachedBundle(p.cacheDir, TAG, sha)).not.toBeNull()
  })

  test('rejects a draft', async () => {
    const { p } = released()
    p.source.setDraft(TAG, true)
    expect(await failures(p)).toEqual([expect.stringContaining('is still a draft')])
  })

  test('rejects a release that is not immutable', async () => {
    const { p } = released()
    p.source.setImmutable(TAG, false)
    expect(await failures(p)).toEqual([expect.stringContaining('is not immutable')])
  })

  test('rejects a bundle digest that is not the ledger’s', async () => {
    const { p } = released()
    p.source.setDigest(TAG, BUNDLE, `sha256:${'0'.repeat(64)}`)
    expect(await failures(p)).toEqual([
      expect.stringContaining(`records digest sha256:${'0'.repeat(64)}`),
    ])
  })

  test('rejects bytes that do not hash to their digest', async () => {
    const { p } = released()
    p.source.setBytes(TAG, BUNDLE, '{"tampered":true}\n')
    expect(await failures(p)).toEqual([expect.stringContaining('downloaded with sha256')])
    expect(existsSync(cachedBundlePath(p.cacheDir, TAG))).toBe(false)
  })

  test('rejects a missing bundle or archive, and an archive without a digest', async () => {
    const { p } = released()
    p.source.removeAsset(TAG, BUNDLE)
    expect(await failures(p)).toEqual([expect.stringContaining(`has no ${BUNDLE} asset`)])

    const again = released()
    again.p.source.removeAsset(TAG, ARCHIVE)
    expect(await failures(again.p)).toEqual([expect.stringContaining(`has no ${ARCHIVE} asset`)])

    const third = released()
    third.p.source.setDigest(TAG, ARCHIVE, null)
    expect(await failures(third.p)).toEqual([expect.stringContaining('records no sha256 digest')])
  })

  test('rejects a tagged, recorded release that was never published', async () => {
    const { fx, p } = released()
    // A GitHub where core was published and component never was.
    const source = new FakeReleaseSource()
    const out = mkdtempSync(join(tmpdir(), 'musher-fetch-test-'))
    try {
      stageRelease(fx.root, 'core/v1.0.0', out)
      source.publishDir('core/v1.0.0', out)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
    expect((await fetchReleases(fx.root, source, p.cacheDir)).failures).toEqual([
      expect.stringContaining(
        'component/v1.0.0: tagged and recorded, but no published GitHub release',
      ),
    ])
  })

  test('rejects a published release the ledger does not record, and ignores an unrecorded draft', async () => {
    const { p } = released()
    p.source.publish('listing/v1.0.0', { 'listing.schema.json': '{}' })
    p.source.publish('blueprint/v1.0.0', { 'blueprint.schema.json': '{}' }, { draft: true })
    p.source.publish('not-a-release-tag', {})
    expect(await failures(p)).toEqual([
      expect.stringContaining('listing/v1.0.0: published on GitHub but absent from published.json'),
    ])
  })

  test('core needs only its archive', async () => {
    const { p } = released()
    expect(await failures(p)).toEqual([])
    p.source.removeAsset('core/v1.0.0', 'core-v1.0.0.tar.gz')
    expect(await failures(p)).toEqual([
      expect.stringContaining('core/v1.0.0: the GitHub release has no core-v1.0.0.tar.gz asset'),
    ])
  })

  test('a verified cache hit asks GitHub nothing about that release', async () => {
    const { p } = released()
    await p.fetch()
    p.source.calls.length = 0
    const result = await fetchReleases(p.fx.root, p.source, p.cacheDir)
    expect(result.cached).toEqual([TAG])
    expect(p.source.calls.filter((call) => call.includes('component'))).toEqual([])
  })

  test('a cache that no longer matches the ledger is a miss, and is fetched again', async () => {
    const { p, sha } = released()
    const path = cachedBundlePath(p.cacheDir, TAG)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{"stale":true}\n')
    expect(readCachedBundle(p.cacheDir, TAG, sha)).toBeNull()
    const result = await fetchReleases(p.fx.root, p.source, p.cacheDir)
    expect(result.verified).toContain(TAG)
    expect(readCachedBundle(p.cacheDir, TAG, sha)).not.toBeNull()
  })

  test('--verify-only goes to GitHub even with a warm cache, and writes nothing', async () => {
    const { p } = released()
    const result = await fetchReleases(p.fx.root, p.source, p.cacheDir, { verifyOnly: true })
    expect(result.verified).toContain(TAG)
    expect(existsSync(cachedBundlePath(p.cacheDir, TAG))).toBe(false)

    await p.fetch()
    const before = readFileSync(cachedBundlePath(p.cacheDir, TAG))
    p.source.calls.length = 0
    await fetchReleases(p.fx.root, p.source, p.cacheDir, { verifyOnly: true })
    expect(p.source.calls).toContain(`release ${TAG}`)
    expect(readFileSync(cachedBundlePath(p.cacheDir, TAG)).equals(before)).toBe(true)
  })
})
