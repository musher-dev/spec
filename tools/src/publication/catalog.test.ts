/**
 * The catalog binds editors to schemas, so it names kind families only.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CATALOG_FILE, canonicalJson, inRepo, REPO_ROOT } from '../lib/layout.ts'
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

  test('reproduces the committed catalog byte for byte', () => {
    expect(canonicalJson(buildCatalog())).toBe(
      readFileSync(inRepo(REPO_ROOT, CATALOG_FILE), 'utf8'),
    )
  })
})
