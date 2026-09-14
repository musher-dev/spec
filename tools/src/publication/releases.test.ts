/**
 * Release naming, and the one identity rule: a pinned bundle and its alias
 * differ in `$id` and nothing else.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { buildBundle, pinnedBundle } from '../schema/bundle.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import {
  aliasUrl,
  assetNames,
  compareVersions,
  isCore,
  parseReleaseTag,
  pinnedUrl,
  stampId,
} from './releases.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

describe('parseReleaseTag', () => {
  test('reads <family>/v<X.Y.Z> and nothing else', () => {
    expect(parseReleaseTag('component/v1.2.3')).toEqual({
      tag: 'component/v1.2.3',
      family: 'component',
      major: 'v1',
      version: '1.2.3',
    })
    for (const tag of ['component/1.2.3', 'v1.2.3', 'component/v1.2', 'Component/v1.0.0']) {
      expect(parseReleaseTag(tag)).toBeNull()
    }
  })
})

describe('compareVersions', () => {
  test('orders numerically, not lexically', () => {
    expect(['1.10.0', '1.9.0', '1.9.10', '2.0.0'].sort(compareVersions)).toEqual([
      '1.9.0',
      '1.9.10',
      '1.10.0',
      '2.0.0',
    ])
  })
})

describe('naming', () => {
  test('asset names and URLs follow the family and version', () => {
    const release = { family: 'listing', version: '1.4.0' }
    expect(assetNames(release)).toEqual({
      bundle: 'listing.schema.json',
      archive: 'listing-v1.4.0.tar.gz',
    })
    expect(pinnedUrl(release)).toBe(
      'https://specifications.musher.dev/listing/v1.4.0/listing.schema.json',
    )
    expect(aliasUrl('listing', 'v1')).toBe(
      'https://specifications.musher.dev/listing/v1/listing.schema.json',
    )
    expect(isCore('core')).toBe(true)
    expect(isCore('component')).toBe(false)
  })
})

describe('stampId', () => {
  test('restamping a pinned build with the alias URL gives the alias build, byte for byte', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { minProperties: 1 }))
    const family = { name: 'component', major: 'v1', repoRoot: fx.root }
    const alias = buildBundle(family) as string
    const pinned = pinnedBundle(family, '1.0.0') as string

    expect(pinned).not.toBe(alias)
    expect(stampId(pinned, aliasUrl('component', 'v1'))).toBe(alias)
    expect(stampId(Buffer.from(alias), pinnedUrl({ family: 'component', version: '1.0.0' }))).toBe(
      pinned,
    )
  })
})
