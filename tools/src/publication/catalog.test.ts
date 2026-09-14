/**
 * The catalog binds editors to schemas, so it names kind families only.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { FixtureRepo } from '../testing/fixture.ts'
import { buildCatalog } from './catalog.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

describe('buildCatalog', () => {
  test('skips core, which has no schema and no document of its own', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.writeCoreSkeleton('v1')
    fx.writeFamilySkeleton('component', 'v1')

    const catalog = buildCatalog(fx.root) as { schemas: { name: string; url: string }[] }
    expect(catalog.schemas.map((s) => s.name)).toEqual(['Musher Component Document'])
    expect(JSON.stringify(catalog)).not.toContain('/core/')
  })

  test('points every kind family at its major-version alias', () => {
    const catalog = buildCatalog() as { schemas: { url: string }[] }
    expect(catalog.schemas.length).toBeGreaterThan(0)
    for (const schema of catalog.schemas) {
      expect(schema.url).toMatch(/^https:\/\/specifications\.musher\.dev\/[a-z-]+\/v\d+\//)
    }
  })
})
