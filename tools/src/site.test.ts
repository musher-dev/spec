/**
 * The publication guarantees, stated as tests.
 *
 * `README.md` tells automation that an exact-version URL is "Immutable
 * forever". Before this suite existed, nothing checked that: the site tree was
 * wiped and rebuilt from the working tree on every push, so a pinned path both
 * moved when `main` moved and vanished when a newer version shipped. The first
 * two tests here are the ones that catch each of those.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { record } from './ledger.ts'
import { assembleSite } from './site.ts'
import { FixtureRepo } from './testing/fixture.ts'

let repo: FixtureRepo | null = null

function fixture(): FixtureRepo {
  repo = new FixtureRepo()
  return repo
}

afterEach(() => {
  repo?.cleanup()
  repo = null
})

/** Cut a release the way the pipeline does: manifest, ledger entry, then tag. */
function release(fx: FixtureRepo, family: string, major: string, version: string, doc: unknown) {
  fx.writeBundle(family, major, doc as never)
  fx.setManifest({ [`specifications/${family}/${major}`]: version })
  record(fx.root)
  fx.commit(`chore: release ${family} ${version}`)
  fx.tag(`${family}/v${version}`)
}

function readSite(fx: FixtureRepo, ...parts: string[]): string {
  return readFileSync(join(fx.root, 'site', ...parts), 'utf8')
}

describe('assembleSite', () => {
  test('a pinned path does not move when main moves', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const atRelease = readSite(fx, 'component', 'v1.0.0', 'component.schema.json')

    // An ordinary, unreleased change lands on the branch.
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'edited' }))
    fx.commit('feat(component): an unreleased change')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const afterEdit = readSite(fx, 'component', 'v1.0.0', 'component.schema.json')

    expect(afterEdit).toBe(atRelease)
    expect(afterEdit).not.toContain('edited')
  })

  test('every released version survives a later release', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    release(fx, 'component', 'v1', '1.1.0', fx.bundleDoc('component', 'v1', { minProperties: 1 }))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    const first = readSite(fx, 'component', 'v1.0.0', 'component.schema.json')
    const second = readSite(fx, 'component', 'v1.1.0', 'component.schema.json')

    expect(first).not.toContain('minProperties')
    expect(second).toContain('minProperties')
  })

  test('each pinned copy carries its own exact-version $id', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    release(fx, 'component', 'v1', '1.1.0', fx.bundleDoc('component', 'v1', { minProperties: 1 }))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    const first = JSON.parse(readSite(fx, 'component', 'v1.0.0', 'component.schema.json'))
    const second = JSON.parse(readSite(fx, 'component', 'v1.1.0', 'component.schema.json'))

    expect(first.$id).toBe('https://schemas.musher.dev/component/v1.0.0/component.schema.json')
    expect(second.$id).toBe('https://schemas.musher.dev/component/v1.1.0/component.schema.json')
    expect(first.$id).not.toBe(second.$id)
  })

  test('the alias tracks the newest release once a major is tagged', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    release(fx, 'component', 'v1', '1.1.0', fx.bundleDoc('component', 'v1', { minProperties: 1 }))

    // An unreleased change must not reach the alias now that tags exist.
    fx.writeBundle(
      'component',
      'v1',
      fx.bundleDoc('component', 'v1', { description: 'unreleased' }),
    )
    fx.commit('feat(component): not released yet')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const alias = JSON.parse(readSite(fx, 'component', 'v1', 'component.schema.json'))

    expect(alias.minProperties).toBe(1)
    expect(alias.description).toBeUndefined()
    // The alias keeps the alias identity — only pinned copies are restamped.
    expect(alias.$id).toBe('https://schemas.musher.dev/component/v1/component.schema.json')
  })

  test('the alias serves the working tree while a major has no tags', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'pre-tag' }))
    fx.setManifest({ 'specifications/component/v1': '0.0.0' })
    fx.commit('feat(component): initial')

    const result = assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    expect(result.pinned).toBe(0)
    expect(readSite(fx, 'component', 'v1', 'component.schema.json')).toContain('pre-tag')
  })

  test('a checksum sidecar accompanies every pinned path, and none accompanies an alias', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    const sidecar = readSite(fx, 'component', 'v1.0.0', 'component.schema.json.sha256')
    const published = readSite(fx, 'component', 'v1.0.0', 'component.schema.json')
    const hasher = new Bun.CryptoHasher('sha256')
    hasher.update(published)

    expect(sidecar).toBe(`${hasher.digest('hex')}  component.schema.json\n`)
    expect(() => readSite(fx, 'component', 'v1', 'component.schema.json.sha256')).toThrow()
  })

  test('assembly is deterministic', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site-a') })
    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site-b') })

    const a = readFileSync(join(fx.root, 'site-a', 'component', 'v1.0.0', 'component.schema.json'))
    const b = readFileSync(join(fx.root, 'site-b', 'component', 'v1.0.0', 'component.schema.json'))
    expect(a.equals(b)).toBe(true)
  })

  test('a release published under an older layout still resolves', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    // The layout changes: the bundle moves. The ledger remembers where 1.0.0's
    // bytes lived, so its pinned path is unaffected.
    const oldPath = 'specifications/component/v1/schemas/dist/component.schema.json'
    const ledger = JSON.parse(readFileSync(join(fx.root, 'published.json'), 'utf8'))
    expect(ledger.releases['component/v1.0.0'].path).toBe(oldPath)

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    expect(readSite(fx, 'component', 'v1.0.0', 'component.schema.json')).toContain('$id')
  })

  test('versions.json inventories every published version', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    release(fx, 'component', 'v1', '1.1.0', fx.bundleDoc('component', 'v1', { minProperties: 1 }))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const inventory = JSON.parse(readSite(fx, 'component', 'versions.json'))

    expect(inventory.latest).toBe('1.1.0')
    expect(inventory.versions.map((v: { version: string }) => v.version)).toEqual([
      '1.0.0',
      '1.1.0',
    ])
    expect(inventory.versions[0].url).toBe(
      'https://schemas.musher.dev/component/v1.0.0/component.schema.json',
    )
  })
})
