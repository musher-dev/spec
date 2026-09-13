/**
 * `site:verify-live` against a site assembled here and served by a fake origin.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FetchLike } from '../publication/github.ts'
import { assembleSite } from '../publication/site.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { Pipeline } from '../testing/pipeline.ts'
import { verifyLive } from './verify-live.ts'

const ORIGIN = 'https://preview.example.test'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

/** Serve a site directory the way the origin would. */
function origin(siteDir: string): FetchLike {
  return async (url) => {
    const { origin: host, pathname } = new URL(url)
    if (host !== ORIGIN) return new Response('wrong host', { status: 421 })
    const path = join(siteDir, ...pathname.split('/'))
    return existsSync(path) ? new Response(readFileSync(path)) : new Response('', { status: 404 })
  }
}

async function deployed(): Promise<{ fx: FixtureRepo; site: string }> {
  const fx = new FixtureRepo()
  repo = fx
  const p = new Pipeline(fx)
  p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
  p.releaseKind('component', 'v1', '1.1.0', fx.bundleDoc('component', 'v1', { minProperties: 1 }))
  fx.writeSources('listing', 'v1', fx.bundleDoc('listing', 'v1'))
  fx.commit('feat(listing): an unreleased family')
  await p.fetch()
  const site = join(fx.root, 'site')
  assembleSite({ repoRoot: fx.root, siteDir: site })
  return { fx, site }
}

describe('verifyLive', () => {
  test('a faithful deploy passes: pinned bundles, sidecars, and every alias', async () => {
    const { fx, site } = await deployed()
    const result = await verifyLive(fx.root, { origin: ORIGIN, fetch: origin(site), delayMs: 0 })
    expect(result.failures).toEqual([])
    expect(result.checked.map((url) => new URL(url).pathname)).toEqual([
      '/component/v1.0.0/component.schema.json',
      '/component/v1.0.0/component.schema.json.sha256',
      '/component/v1.1.0/component.schema.json',
      '/component/v1.1.0/component.schema.json.sha256',
      '/component/v1/component.schema.json',
      '/listing/v1/listing.schema.json',
    ])
  })

  test('an alias that is not the newest release restamped fails, after its retries', async () => {
    const { fx, site } = await deployed()
    const alias = join(site, 'component', 'v1', 'component.schema.json')
    writeFileSync(alias, readFileSync(join(site, 'component', 'v1.0.0', 'component.schema.json')))
    const result = await verifyLive(fx.root, {
      origin: ORIGIN,
      fetch: origin(site),
      attempts: 2,
      delayMs: 0,
    })
    expect(result.failures).toEqual([
      expect.stringContaining('/component/v1/component.schema.json: expected sha256'),
    ])
    expect(result.failures[0]).toContain('after 2 attempt(s)')
  })

  test('a pinned path that is missing fails', async () => {
    const { fx, site } = await deployed()
    const result = await verifyLive(fx.root, {
      origin: ORIGIN,
      fetch: origin(join(site, 'nowhere')),
      attempts: 1,
      delayMs: 0,
    })
    expect(result.failures.some((f) => f.includes('v1.0.0/component.schema.json: expected'))).toBe(
      true,
    )
    expect(result.failures.every((f) => f.includes('HTTP 404'))).toBe(true)
  })
})
