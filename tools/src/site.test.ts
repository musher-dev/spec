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
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { record } from './ledger.ts'
import { assembleSite, type HeaderRule, renderHeaders } from './site.ts'
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

/** Every file in a site tree, as the `/`-prefixed paths a request would name. */
function servedPaths(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else found.push(`/${relative(root, path).split(/[\\/]/).join('/')}`)
    }
  }
  walk(root)
  return found.filter((path) => path !== '/_headers')
}

/** Read `_headers` back into the rules it declares. */
function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    if (line.startsWith('  ')) {
      const rule = rules[rules.length - 1]
      if (rule === undefined) throw new Error(`header before any source: ${line}`)
      ;(rule.headers as string[]).push(line.trim())
      continue
    }
    rules.push({ source: line, headers: [] })
  }
  return rules
}

/**
 * Cloudflare's source matching, written out independently of the generator's
 * own copy: a test that reuses the implementation under test would agree with
 * it about a pattern they both got wrong.
 */
function matches(source: string, path: string): boolean {
  if (!source.includes('*')) return source === path
  const [head = '', tail = ''] = source.split('*')
  return path.length >= head.length + tail.length && path.startsWith(head) && path.endsWith(tail)
}

/** The headers a request for `path` would actually receive, per rule name. */
function resolve(rules: readonly HeaderRule[], path: string): Map<string, string[]> {
  const resolved = new Map<string, string[]>()
  for (const rule of rules) {
    if (!matches(rule.source, path)) continue
    for (const header of rule.headers) {
      const [name = '', ...rest] = header.split(':')
      resolved.set(name, [...(resolved.get(name) ?? []), rest.join(':').trim()])
    }
  }
  return resolved
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

    // The whole tree, not one file: `_headers` and the pages are assembled from
    // maps and sorts, which is exactly where a nondeterministic order hides.
    const a = servedPaths(join(fx.root, 'site-a'))
    expect(a).toEqual(servedPaths(join(fx.root, 'site-b')))
    for (const path of [...a, '/_headers']) {
      const left = readFileSync(join(fx.root, 'site-a', path))
      const right = readFileSync(join(fx.root, 'site-b', path))
      expect(left.equals(right)).toBe(true)
    }
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

  // ---------------------------------------------------------------------------
  // The cache contract. Cloudflare Pages merges every matching rule and
  // comma-joins duplicate header names, so `_headers` is only correct if no two
  // rules that match the same path set the same header.
  // ---------------------------------------------------------------------------

  test('no published path draws the same header from two rules', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    release(fx, 'component', 'v1', '1.1.0', fx.bundleDoc('component', 'v1', { minProperties: 1 }))
    fx.writeBundle('listing', 'v1', fx.bundleDoc('listing', 'v1'))
    fx.commit('feat(listing): an untagged family')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const rules = parseHeaders(readSite(fx, '_headers'))

    for (const path of servedPaths(join(fx.root, 'site'))) {
      for (const [name, values] of resolve(rules, path)) {
        expect(`${path} ${name}: ${values.length}`).toBe(`${path} ${name}: 1`)
      }
    }
  })

  test('a pinned path is immutable and its alias is not', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const rules = parseHeaders(readSite(fx, '_headers'))

    expect(resolve(rules, '/component/v1.0.0/component.schema.json').get('Cache-Control')).toEqual([
      'public, max-age=31536000, immutable',
    ])
    expect(resolve(rules, '/component/v1/component.schema.json').get('Cache-Control')).toEqual([
      'public, max-age=300, must-revalidate',
    ])
  })

  test('a checksum sidecar inherits its release immutability and its own type', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const sidecar = resolve(
      parseHeaders(readSite(fx, '_headers')),
      '/component/v1.0.0/component.schema.json.sha256',
    )

    expect(sidecar.get('Cache-Control')).toEqual(['public, max-age=31536000, immutable'])
    expect(sidecar.get('Content-Type')).toEqual(['text/plain; charset=utf-8'])
  })

  test('every schema is served cross-origin as application/schema+json', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const rules = parseHeaders(readSite(fx, '_headers'))

    // README tells editors and browser-based validators to fetch these URLs.
    for (const path of servedPaths(join(fx.root, 'site'))) {
      expect(resolve(rules, path).get('Access-Control-Allow-Origin')).toEqual(['*'])
    }
    for (const path of [
      '/component/v1/component.schema.json',
      '/component/v1.0.0/component.schema.json',
    ]) {
      expect(resolve(rules, path).get('Content-Type')).toEqual([
        'application/schema+json; charset=utf-8',
      ])
    }
  })

  test('the rule budget fails the build before Cloudflare rejects the file', () => {
    const rules: HeaderRule[] = Array.from({ length: 91 }, (_, index) => ({
      source: `/component/v1.0.${index}/*`,
      headers: ['Cache-Control: public, max-age=31536000, immutable'],
    }))

    expect(() => renderHeaders(rules.slice(0, 90))).not.toThrow()
    expect(() => renderHeaders(rules)).toThrow(/budget is 90/)
  })

  test('no GitHub Pages artifact is published', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ 'specifications/component/v1': '0.0.0' })
    fx.commit('feat(component): initial')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    // CNAME never did anything on an Actions-published Pages site, and on
    // Cloudflare it would be served as a static file at /CNAME.
    expect(() => readSite(fx, 'CNAME')).toThrow()
    expect(() => readSite(fx, '.nojekyll')).toThrow()
  })

  // ---------------------------------------------------------------------------
  // The human entry point.
  // ---------------------------------------------------------------------------

  test('the root index names every family and its alias', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    fx.writeBundle('listing', 'v1', fx.bundleDoc('listing', 'v1'))
    fx.commit('feat(listing): an untagged family')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const index = readSite(fx, 'index.html')

    expect(index).toContain('href="/component/v1/component.schema.json"')
    expect(index).toContain('href="/listing/v1/listing.schema.json"')
    // The prose link resolves at the ref the alias actually serves.
    expect(index).toContain('/blob/component/v1.0.0/specifications/component/v1/spec.md')
    expect(index).toContain('/blob/main/specifications/listing/v1/spec.md')
  })

  test('a family index lists every published version with its checksum', () => {
    const fx = fixture()
    release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    release(fx, 'component', 'v1', '1.1.0', fx.bundleDoc('component', 'v1', { minProperties: 1 }))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const page = readSite(fx, 'component', 'index.html')
    const inventory = JSON.parse(readSite(fx, 'component', 'versions.json'))

    for (const version of inventory.versions) {
      expect(page).toContain(`/component/v${version.version}/component.schema.json`)
      expect(page).toContain(version.sha256)
    }
    expect(page).toContain('versions.json')
  })

  test('a family index says plainly that an untagged family has released nothing', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ 'specifications/component/v1': '0.0.0' })
    fx.commit('feat(component): initial')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const page = readSite(fx, 'component', 'index.html')

    expect(page).toContain('Nothing has been released')
    // versions.json is not written for such a family, so it must not be linked.
    expect(page).not.toContain('versions.json')
  })

  test('a not-found page is published', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ 'specifications/component/v1': '0.0.0' })
    fx.commit('feat(component): initial')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    expect(readSite(fx, '404.html')).toContain('Not found')
  })
})
