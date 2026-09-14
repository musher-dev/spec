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
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { CORE_FAMILY, canonicalJson, familyPaths, type Json, LayoutError } from '../lib/layout.ts'
import { pinnedBundle } from '../schema/bundle.ts'
import { gitReader } from '../schema/sources.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { Pipeline } from '../testing/pipeline.ts'
import { cachedBundlePath, fetchReleases } from './fetch.ts'
import { LEDGER_FILE, type LedgerEntry, readLedger, serializeLedger } from './ledger.ts'
import { aliasUrl, sha256, stampId } from './releases.ts'
import { assembleSite, type HeaderRule, renderHeaders } from './site.ts'

const COMPONENT = familyPaths('component', 'v1')
const CORE = familyPaths(CORE_FAMILY, 'v1')

let repo: FixtureRepo | null = null
let pipeline: Pipeline | null = null

function fixture(): FixtureRepo {
  repo = new FixtureRepo()
  pipeline = new Pipeline(repo)
  return repo
}

afterEach(() => {
  repo?.cleanup()
  repo = null
  pipeline = null
})

function p(): Pipeline {
  if (pipeline === null) throw new Error('no fixture')
  return pipeline
}

/**
 * Release a version the way the pipeline does — record, tag, stage, publish —
 * and verify every published release into the cache the site reads.
 */
async function release(
  _fx: FixtureRepo,
  family: string,
  major: string,
  version: string,
  doc: Json,
) {
  p().releaseKind(family, major, version, doc)
  await p().fetch()
}

/** The error a call throws, or undefined when it returns. */
function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
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
  // ---------------------------------------------------------------------------
  // The generated reference.
  // ---------------------------------------------------------------------------

  const PROSE = '## <a id="scope"></a>1. Released prose\n'
  const DRAFT = '## <a id="scope"></a>1. Unreleased prose\n'

  test('the reference describes the tag the alias serves, not the working tree', async () => {
    // The bug this rules out is invisible today: with no tags, a reference
    // built from the working tree passes everything and starts lying on the
    // first release.
    const fx = fixture()
    fx.writeFile(COMPONENT.spec, PROSE)
    await release(
      fx,
      'component',
      'v1',
      '1.0.0',
      fx.bundleDoc('component', 'v1', {
        properties: { released: { type: 'string', description: 'shipped in 1.0.0' } },
      }),
    )

    fx.writeFile(COMPONENT.spec, DRAFT)
    fx.writeSources(
      'component',
      'v1',
      fx.bundleDoc('component', 'v1', {
        properties: { unreleased: { type: 'string', description: 'only on main' } },
      }),
    )
    fx.commit('feat(component): add a field that is not released')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    for (const version of ['v1', 'v1.0.0']) {
      const reference = readSite(fx, 'reference', 'component', version, 'index.html')
      expect(reference).toContain('released')
      expect(reference).not.toContain('only on main')
      const prose = readSite(fx, 'reference', 'component', version, 'spec', 'index.html')
      expect(prose).toContain('Released prose')
      expect(prose).not.toContain('Unreleased prose')
    }
  })

  test('an untagged family renders from the working tree', () => {
    const fx = fixture()
    fx.writeFile(COMPONENT.spec, PROSE)
    fx.writeSources(
      'component',
      'v1',
      fx.bundleDoc('component', 'v1', { properties: { drafted: { type: 'string' } } }),
    )
    fx.commit('feat(component): draft')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    expect(readSite(fx, 'reference', 'component', 'v1', 'index.html')).toContain('drafted')
  })

  test('no reference path draws a Cache-Control header', async () => {
    const fx = fixture()
    fx.writeFile(COMPONENT.spec, PROSE)
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    const site = join(fx.root, 'site')
    assembleSite({ repoRoot: fx.root, siteDir: site })
    const rules = parseHeaders(readFileSync(join(site, '_headers'), 'utf8'))

    const referencePaths = servedPaths(site).filter((path) => path.startsWith('/reference/'))
    expect(referencePaths.length).toBeGreaterThan(0)
    for (const path of referencePaths) {
      expect(resolve(rules, path).get('Cache-Control')).toBeUndefined()
      // The shape rule still reaches them, which is what makes them fetchable.
      expect(resolve(rules, path).get('Access-Control-Allow-Origin')).toEqual(['*'])
    }
  })

  test('the reference costs no header rules, however many versions it renders', async () => {
    const fx = fixture()
    fx.writeFile(COMPONENT.spec, PROSE)
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    await release(fx, 'component', 'v1', '1.1.0', fx.bundleDoc('component', 'v1'))
    await release(fx, 'component', 'v1', '1.2.0', fx.bundleDoc('component', 'v1'))

    const site = join(fx.root, 'site')
    assembleSite({ repoRoot: fx.root, siteDir: site })
    expect(readFileSync(join(site, '_headers'), 'utf8')).not.toContain('/reference')
    expect(servedPaths(site).filter((p) => p.startsWith('/reference/')).length).toBeGreaterThan(3)
  })

  test('the examples page carries every example, verbatim, from the same ref', async () => {
    const fx = fixture()
    fx.writeFile(COMPONENT.spec, PROSE)
    fx.writeFile(`${COMPONENT.examples}/minimal.yaml`, 'kind: COMPONENT # released\n')
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    // Move both the example and add a second one on main.
    fx.writeFile(`${COMPONENT.examples}/minimal.yaml`, 'kind: COMPONENT # on main\n')
    fx.writeFile(`${COMPONENT.examples}/extra.yaml`, 'kind: COMPONENT # new\n')
    fx.commit('docs(component): revise the examples')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    const pinned = readSite(fx, 'reference', 'component', 'v1.0.0', 'examples', 'index.html')
    expect(pinned).toContain('kind: COMPONENT # released')
    expect(pinned).not.toContain('on main')
    expect(pinned).not.toContain('extra.yaml')

    const alias = readSite(fx, 'reference', 'component', 'v1', 'examples', 'index.html')
    expect(alias).toContain('kind: COMPONENT # released')
  })

  test('a family with no examples gets no examples page and no link to one', () => {
    const fx = fixture()
    fx.writeFile(COMPONENT.spec, PROSE)
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.commit('feat(component): a family with no examples')

    const site = join(fx.root, 'site')
    assembleSite({ repoRoot: fx.root, siteDir: site })
    expect(servedPaths(site)).not.toContain('/reference/component/v1/examples/index.html')
    expect(readSite(fx, 'reference', 'component', 'v1', 'index.html')).not.toContain(
      'href="/reference/component/v1/examples/"',
    )
  })

  test('a family named after the reference namespace is refused by name', () => {
    const fx = fixture()
    fx.writeSources('reference', 'v1', fx.bundleDoc('reference', 'v1'))
    fx.commit('feat: a family that would collide')
    expect(() => assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })).toThrow(
      /reserved top-level path/,
    )
  })

  test('a ref carrying no spec.md renders no prose page and offers no link to one', () => {
    const fx = fixture()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.commit('feat(component): a bundle with no prose beside it')

    const site = join(fx.root, 'site')
    assembleSite({ repoRoot: fx.root, siteDir: site })
    expect(servedPaths(site)).not.toContain('/reference/component/v1/spec/index.html')
    // Not a bare '/spec/' or 'spec.md': the GitHub source link to the prose may
    // legitimately remain. What must be absent is the on-origin page.
    expect(readSite(fx, 'reference', 'component', 'v1', 'index.html')).not.toContain(
      'href="/reference/component/v1/spec/"',
    )
  })

  test('a pending release is left out under ALLOW_PENDING_RELEASES, and fails the build without it', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    p().releaseKind(
      'component',
      'v1',
      '1.1.0',
      fx.bundleDoc('component', 'v1', { minProperties: 1 }),
    )
    p().source.setDraft('component/v1.1.0', true)
    const fetched = await fetchReleases(fx.root, p().source, p().cacheDir, { allowPending: true })
    expect(fetched.pending).toEqual(['component/v1.1.0'])

    const site = join(fx.root, 'site')
    assembleSite({ repoRoot: fx.root, siteDir: site, cacheDir: p().cacheDir, allowPending: true })
    const served = servedPaths(site)
    expect(served).toContain('/component/v1.0.0/component.schema.json')
    expect(served).not.toContain('/component/v1.1.0/component.schema.json')
    const versions = readSite(fx, 'component', 'versions.json')
    expect(versions).toContain('1.0.0')
    expect(versions).not.toContain('1.1.0')

    expect(() =>
      assembleSite({
        repoRoot: fx.root,
        siteDir: site,
        cacheDir: p().cacheDir,
        allowPending: false,
      }),
    ).toThrow(/component\/v1\.1\.0: no verified release asset/)
  })

  test('a release tag lacking examples/ fails loudly rather than rendering none', async () => {
    // Before the layout module, a moved examples directory read as "this
    // release has no examples" and the site deployed without them.
    const fx = fixture()
    fx.writeFamilySkeleton('component', 'v1')
    fx.remove(COMPONENT.examples)
    const tag = p().releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'), {
      skeleton: false,
      publish: false,
    })
    // release:stage now refuses a release without examples, so publish the
    // bytes by hand — a release cut by older tooling, which the site must
    // still refuse to render without them.
    const bundle = pinnedBundle({ name: 'component', major: 'v1', repoRoot: fx.root }, '1.0.0', {
      reader: gitReader(fx.root, tag),
    })
    p().source.publish(tag, {
      'component.schema.json': bundle as string,
      'component-v1.0.0.tar.gz': 'archive',
    })
    await p().fetch()

    const error = thrown(() => assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') }))
    expect(error).toBeInstanceOf(LayoutError)
    expect((error as Error).message).toContain('component/v1.0.0')
    expect((error as Error).message).toContain(COMPONENT.examples)
  })

  test('a ledger path whose tag carries no spec.md fails loudly rather than rendering no prose', async () => {
    // A release cannot be recorded without prose — the core gate reads its §2 —
    // so the only way to reach this is a ledger path the tag does not carry.
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    const ledger = readLedger(fx.root)
    const entry = ledger.releases['component/v1.0.0']
    fx.writeFile(
      LEDGER_FILE,
      serializeLedger({
        version: 2,
        releases: {
          ...ledger.releases,
          'component/v1.0.0': { ...(entry as LedgerEntry), path: COMPONENT.conformance },
        },
      }),
    )

    const error = thrown(() => assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') }))
    expect(error).toBeInstanceOf(LayoutError)
    expect((error as Error).message).toContain(`${COMPONENT.conformance}/spec.md`)
  })

  test('a pinned path does not move when main moves', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const atRelease = readSite(fx, 'component', 'v1.0.0', 'component.schema.json')

    // An ordinary, unreleased change lands on the branch.
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'edited' }))
    fx.commit('feat(component): an unreleased change')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const afterEdit = readSite(fx, 'component', 'v1.0.0', 'component.schema.json')

    expect(afterEdit).toBe(atRelease)
    expect(afterEdit).not.toContain('edited')
  })

  test('every released version survives a later release', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    await release(
      fx,
      'component',
      'v1',
      '1.1.0',
      fx.bundleDoc('component', 'v1', { minProperties: 1 }),
    )

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    const first = readSite(fx, 'component', 'v1.0.0', 'component.schema.json')
    const second = readSite(fx, 'component', 'v1.1.0', 'component.schema.json')

    expect(first).not.toContain('minProperties')
    expect(second).toContain('minProperties')
  })

  test('each pinned copy carries its own exact-version $id', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    await release(
      fx,
      'component',
      'v1',
      '1.1.0',
      fx.bundleDoc('component', 'v1', { minProperties: 1 }),
    )

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    const first = JSON.parse(readSite(fx, 'component', 'v1.0.0', 'component.schema.json'))
    const second = JSON.parse(readSite(fx, 'component', 'v1.1.0', 'component.schema.json'))

    expect(first.$id).toBe(
      'https://specifications.musher.dev/component/v1.0.0/component.schema.json',
    )
    expect(second.$id).toBe(
      'https://specifications.musher.dev/component/v1.1.0/component.schema.json',
    )
    expect(first.$id).not.toBe(second.$id)
  })

  test('the alias tracks the newest release once a major is tagged', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    await release(
      fx,
      'component',
      'v1',
      '1.1.0',
      fx.bundleDoc('component', 'v1', { minProperties: 1 }),
    )

    // An unreleased change must not reach the alias now that tags exist.
    fx.writeSources(
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
    expect(alias.$id).toBe('https://specifications.musher.dev/component/v1/component.schema.json')
  })

  test('an untagged alias is built from sources, with no bundle file anywhere', () => {
    const fx = fixture()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'built' }))
    fx.commit('feat(component): sources only')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    expect(readSite(fx, 'component', 'v1', 'component.schema.json')).toBe(
      canonicalJson(fx.bundleDoc('component', 'v1', { description: 'built' })),
    )
    expect(() => readFileSync(join(fx.root, COMPONENT.bundle))).toThrow()
  })

  test('the alias serves the working tree while a major has no tags', () => {
    const fx = fixture()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'pre-tag' }))
    fx.setManifest({ [COMPONENT.manifestKey]: '0.0.0' })
    fx.commit('feat(component): initial')

    const result = assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    expect(result.pinned).toBe(0)
    expect(readSite(fx, 'component', 'v1', 'component.schema.json')).toContain('pre-tag')
  })

  test('a checksum sidecar accompanies every pinned path, and none accompanies an alias', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    const sidecar = readSite(fx, 'component', 'v1.0.0', 'component.schema.json.sha256')
    const published = readSite(fx, 'component', 'v1.0.0', 'component.schema.json')
    const hasher = new Bun.CryptoHasher('sha256')
    hasher.update(published)

    expect(sidecar).toBe(`${hasher.digest('hex')}  component.schema.json\n`)
    expect(() => readSite(fx, 'component', 'v1', 'component.schema.json.sha256')).toThrow()
  })

  test('assembly is deterministic', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

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

  test('a release is recorded against the family version directory it was built from', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    // No bundle is tracked, so the ledger names where the release's sources
    // lived rather than a bundle path the tag never carried.
    const ledger = JSON.parse(readFileSync(join(fx.root, 'published.json'), 'utf8'))
    expect(ledger.releases['component/v1.0.0'].path).toBe(COMPONENT.dir)

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    expect(readSite(fx, 'component', 'v1.0.0', 'component.schema.json')).toContain('$id')
  })

  test('versions.json inventories every published version', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    await release(
      fx,
      'component',
      'v1',
      '1.1.0',
      fx.bundleDoc('component', 'v1', { minProperties: 1 }),
    )

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const inventory = JSON.parse(readSite(fx, 'component', 'versions.json'))

    expect(inventory.latest).toBe('1.1.0')
    expect(inventory.versions.map((v: { version: string }) => v.version)).toEqual([
      '1.0.0',
      '1.1.0',
    ])
    expect(inventory.versions[0].url).toBe(
      'https://specifications.musher.dev/component/v1.0.0/component.schema.json',
    )
  })

  // ---------------------------------------------------------------------------
  // The cache contract. Cloudflare Pages merges every matching rule and
  // comma-joins duplicate header names, so `_headers` is only correct if no two
  // rules that match the same path set the same header.
  // ---------------------------------------------------------------------------

  test('no published path draws the same header from two rules', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    await release(
      fx,
      'component',
      'v1',
      '1.1.0',
      fx.bundleDoc('component', 'v1', { minProperties: 1 }),
    )
    fx.writeSources('listing', 'v1', fx.bundleDoc('listing', 'v1'))
    fx.commit('feat(listing): an untagged family')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const rules = parseHeaders(readSite(fx, '_headers'))

    for (const path of servedPaths(join(fx.root, 'site'))) {
      for (const [name, values] of resolve(rules, path)) {
        expect(`${path} ${name}: ${values.length}`).toBe(`${path} ${name}: 1`)
      }
    }
  })

  test('a pinned path is immutable and its alias is not', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const rules = parseHeaders(readSite(fx, '_headers'))

    expect(resolve(rules, '/component/v1.0.0/component.schema.json').get('Cache-Control')).toEqual([
      'public, max-age=31536000, immutable',
    ])
    expect(resolve(rules, '/component/v1/component.schema.json').get('Cache-Control')).toEqual([
      'public, max-age=300, must-revalidate',
    ])
  })

  test('a checksum sidecar inherits its release immutability and its own type', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const sidecar = resolve(
      parseHeaders(readSite(fx, '_headers')),
      '/component/v1.0.0/component.schema.json.sha256',
    )

    expect(sidecar.get('Cache-Control')).toEqual(['public, max-age=31536000, immutable'])
    expect(sidecar.get('Content-Type')).toEqual(['text/plain; charset=utf-8'])
  })

  test('every schema is served cross-origin as application/schema+json', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))

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
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT.manifestKey]: '0.0.0' })
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

  test('the root index names every family and its alias', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    fx.writeSources('listing', 'v1', fx.bundleDoc('listing', 'v1'))
    fx.commit('feat(listing): an untagged family')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const index = readSite(fx, 'index.html')

    expect(index).toContain('href="/component/v1/component.schema.json"')
    expect(index).toContain('href="/listing/v1/listing.schema.json"')
    // The prose link resolves at the ref the alias actually serves.
    expect(index).toContain(`/blob/component/v1.0.0/${COMPONENT.spec}`)
    expect(index).toContain(`/blob/main/${familyPaths('listing', 'v1').spec}`)
  })

  test('a family index lists every published version with its checksum', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    await release(
      fx,
      'component',
      'v1',
      '1.1.0',
      fx.bundleDoc('component', 'v1', { minProperties: 1 }),
    )

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
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT.manifestKey]: '0.0.0' })
    fx.commit('feat(component): initial')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const page = readSite(fx, 'component', 'index.html')

    expect(page).toContain('Nothing has been released')
    // versions.json is not written for such a family, so it must not be linked.
    expect(page).not.toContain('versions.json')
  })

  test('a not-found page is published', async () => {
    const fx = fixture()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT.manifestKey]: '0.0.0' })
    fx.commit('feat(component): initial')

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })

    expect(readSite(fx, '404.html')).toContain('Not found')
  })

  // ---------------------------------------------------------------------------
  // A family that ships no schema (core, docs/adr/0022).
  // ---------------------------------------------------------------------------

  test('a schema-less family publishes prose pages only, from its tag, with no header rule', async () => {
    const fx = fixture()
    p().releaseCore('1.0.0', '## <a id="scope"></a>1. Core released prose\n')
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    fx.writeFile(CORE.spec, '## <a id="scope"></a>1. Core draft prose\n')
    fx.commit('docs(core): an unreleased edit')

    const site = join(fx.root, 'site')
    const result = assembleSite({ repoRoot: fx.root, siteDir: site })
    const served = servedPaths(site)

    // Prose for the line and for the release, and a family index.
    for (const path of [
      '/reference/core/v1/spec/index.html',
      '/reference/core/v1.0.0/spec/index.html',
      '/core/index.html',
    ]) {
      expect(served).toContain(path)
    }
    // No field reference, no examples, no alias, no pinned path, no inventory.
    const coreServed = served.filter(
      (p) => p.startsWith('/core/') || p.startsWith('/reference/core/'),
    )
    expect(coreServed.sort()).toEqual([
      '/core/index.html',
      '/reference/core/v1.0.0/spec/index.html',
      '/reference/core/v1/spec/index.html',
    ])
    expect(result.pinned).toBe(1)
    expect(result.aliases).toBe(1)

    // The line serves its newest tag, not main.
    const line = readSite(fx, 'reference', 'core', 'v1', 'spec', 'index.html')
    expect(line).toContain('Core released prose')
    expect(line).not.toContain('Core draft prose')
    expect(line).not.toContain('JSON Schema')
    expect(line).not.toContain('Field reference')

    // The cache contract never mentions core, and no core path draws Cache-Control.
    const headers = readSite(fx, '_headers')
    expect(headers).not.toContain('core')
    const rules = parseHeaders(headers)
    for (const path of coreServed) {
      expect(resolve(rules, path).get('Cache-Control')).toBeUndefined()
    }

    const index = readSite(fx, 'index.html')
    expect(index).toContain('href="/core/"')
    expect(index).toContain('href="/reference/core/v1/spec/"')
    expect(index).not.toContain('/core/v1/core.schema.json')
    const familyIndex = readSite(fx, 'core', 'index.html')
    expect(familyIndex).toContain('href="/reference/core/v1.0.0/spec/"')
    expect(familyIndex).not.toContain('versions.json')
    expect(readSite(fx, 'reference', 'index.html')).toContain('href="/reference/core/v1/spec/"')
  })

  test('an untagged schema-less family renders its prose from the working tree', () => {
    const fx = fixture()
    fx.writeCoreSkeleton('v1', '## <a id="envelope"></a>2. Core envelope draft\n')
    fx.writeFile(
      COMPONENT.spec,
      '## <a id="scope"></a>1. Scope\n\nSee [core v1 §2](../../core/v1/spec.md#envelope).\n',
    )
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.commit('feat(core): the base family')

    const site = join(fx.root, 'site')
    assembleSite({ repoRoot: fx.root, siteDir: site })

    expect(readSite(fx, 'reference', 'core', 'v1', 'spec', 'index.html')).toContain(
      'Core envelope draft',
    )
    expect(readSite(fx, 'core', 'index.html')).toContain('Nothing has been released')
    expect(servedPaths(site)).not.toContain('/reference/core/v1/index.html')
    // A kind family citing core stays on this origin.
    expect(readSite(fx, 'reference', 'component', 'v1', 'spec', 'index.html')).toContain(
      'href="/reference/core/v1/spec/#envelope"',
    )
    // Core leads the root index.
    const index = readSite(fx, 'index.html')
    expect(index.indexOf('href="/core/"')).toBeLessThan(index.indexOf('href="/component/"'))
  })
  // ---------------------------------------------------------------------------
  // Pinned bytes come from verified release assets and nowhere else.
  // ---------------------------------------------------------------------------

  test('a tagged release with no verified asset in the cache throws rather than rebuilding', () => {
    const fx = fixture()
    // Recorded, tagged and published, but never fetched.
    p().releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    expect(() => assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })).toThrow(
      /component\/v1\.0\.0: no verified release asset .* Run `task site:fetch`/,
    )
  })

  test('a cached bundle that no longer hashes to the ledger is a miss', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    writeFileSync(cachedBundlePath(p().cacheDir, 'component/v1.0.0'), '{"tampered":true}\n')
    expect(() => assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })).toThrow(
      /task site:fetch/,
    )
  })

  test('a released alias is the newest pinned bundle with its $id restamped', async () => {
    const fx = fixture()
    await release(fx, 'component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    await release(
      fx,
      'component',
      'v1',
      '1.1.0',
      fx.bundleDoc('component', 'v1', { minProperties: 1 }),
    )

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    const pinned = readSite(fx, 'component', 'v1.1.0', 'component.schema.json')
    expect(readSite(fx, 'component', 'v1', 'component.schema.json')).toBe(
      stampId(pinned, aliasUrl('component', 'v1')),
    )
  })

  test("the ledger's path locates a release's prose and examples at its tag", async () => {
    const fx = fixture()
    p().releaseCore('1.0.0')
    // A release recorded where an older layout kept the family.
    const legacy = 'legacy/component-v1'
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.writeFile(
      `${legacy}/spec.md`,
      fx.kindSpec('component', '## <a id="scope"></a>1. Legacy prose\n'),
    )
    fx.writeFile(`${legacy}/examples/legacy.yaml`, 'kind: COMPONENT # legacy\n')
    fx.commit('feat(component): the legacy layout')
    const pinned = pinnedBundle({ name: 'component', major: 'v1', repoRoot: fx.root }, '1.0.0', {
      reader: gitReader(fx.root, 'HEAD'),
    }) as string
    fx.writeFile(
      LEDGER_FILE,
      serializeLedger({
        version: 2,
        releases: {
          ...readLedger(fx.root).releases,
          'component/v1.0.0': {
            path: legacy,
            tree: fx.treeId('HEAD', legacy),
            bundleSha256: sha256(pinned),
            requires: { core: '1.0.0' },
          },
        },
      }),
    )
    fx.commit('chore(repo): release component 1.0.0')
    fx.tag('component/v1.0.0')
    // This tooling would not stage a release at a path it does not build from,
    // so seed the cache with the verified bytes the release would have carried.
    const cached = cachedBundlePath(p().cacheDir, 'component/v1.0.0')
    mkdirSync(dirname(cached), { recursive: true })
    writeFileSync(cached, pinned)

    assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })
    expect(readSite(fx, 'reference', 'component', 'v1.0.0', 'spec', 'index.html')).toContain(
      'Legacy prose',
    )
    expect(readSite(fx, 'reference', 'component', 'v1.0.0', 'examples', 'index.html')).toContain(
      '# legacy',
    )
    expect(readSite(fx, 'index.html')).toContain(`/blob/component/v1.0.0/${legacy}/spec.md`)
  })
})
