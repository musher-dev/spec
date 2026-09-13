/**
 * The whole publication pipeline, locally, in the order a real first release
 * runs it (docs/adr/0023 §2):
 *
 *   core released → a chore(core) commit → component recorded (warns only),
 *   re-recorded after its branch moves, tagged → staged → published as an
 *   immutable release → fetched and verified → assembled into the site.
 *
 * Then the two ways it must refuse: tampered release bytes fail the fetch, and
 * a releasable core commit blocks the next kind family record.
 *
 * The steps share one repository and run in order.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBlobAtRef } from '../lib/git.ts'
import { CORE_FAMILY, Failures, familyPaths } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { Pipeline } from '../testing/pipeline.ts'
import { cachedBundlePath, fetchReleases } from './fetch.ts'
import { readLedger } from './ledger.ts'
import { RecordError, record } from './record.ts'
import { sha256 } from './releases.ts'
import { assembleSite } from './site.ts'
import { stageRelease } from './stage.ts'
import { verifyPublications } from './verify.ts'

const COMPONENT = familyPaths('component', 'v1')
const CORE = familyPaths(CORE_FAMILY, 'v1')
const TAG = 'component/v1.0.0'

let fx: FixtureRepo
let p: Pipeline
let staged: string

beforeAll(() => {
  fx = new FixtureRepo()
  p = new Pipeline(fx)
  staged = mkdtempSync(join(tmpdir(), 'musher-e2e-'))
})

afterAll(() => {
  fx.cleanup()
  rmSync(staged, { recursive: true, force: true })
})

function verified(): string[] {
  const failures = new Failures()
  verifyPublications(fx.root, failures)
  return [...failures.messages]
}

describe('the publication pipeline, end to end', () => {
  test('1. core 1.0.0 is recorded with no bundle, tagged, staged and published', () => {
    p.releaseCore('1.0.0', '## <a id="scope"></a>1. Core, as released in 1.0.0\n')
    expect(readLedger(fx.root).releases['core/v1.0.0']).toMatchObject({
      path: CORE.dir,
      bundleSha256: null,
    })
    expect(verified()).toEqual([])
  })

  test('2. a chore(core) commit after the core tag lets component record, with a warning', () => {
    fx.writeFile(CORE.spec, '## <a id="scope"></a>1. Core, as released in 1.0.0 (tidied)\n')
    fx.commit('chore(core): tidy')

    fx.writeFamilySkeleton('component', 'v1')
    fx.writeFile(COMPONENT.spec, fx.kindSpec('component'))
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifestVersion(COMPONENT.manifestKey, '1.0.0')
    fx.commit('feat(component): component 1.0.0')

    const result = record(fx.root)
    expect(result.recorded).toEqual([TAG])
    expect(result.warnings).toEqual([
      expect.stringContaining('1 non-releasable commit(s) since core/v1.0.0'),
    ])
    expect(readLedger(fx.root).releases[TAG]?.requires).toEqual({ core: '1.0.0' })
  })

  test('3. the release branch moves; record updates the pending entry, and it verifies', () => {
    fx.commit('chore(repo): release component 1.0.0')
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { minProperties: 1 }))
    fx.commit('feat(component): brought in by Update branch')
    expect(verified()).not.toEqual([])

    expect(record(fx.root).updated).toEqual([TAG])
    fx.commit('chore(repo): release component 1.0.0')
    expect(verified()).toEqual([])
  })

  test('4. merged and tagged; staging proves the bundle and ships core 1.0.0, not HEAD’s core', () => {
    fx.tag(TAG)
    const files = stageRelease(fx.root, TAG, staged)
    const entry = readLedger(fx.root).releases[TAG]
    expect(files.find((f) => f.name === 'component.schema.json')?.sha256).toBe(
      entry?.bundleSha256 as string,
    )
    const archivedCore = spawnSync(
      'tar',
      ['-xzOf', join(staged, 'component-v1.0.0.tar.gz'), 'component-v1/core/spec.md'],
      { encoding: 'utf8' },
    ).stdout
    expect(archivedCore).toBe(
      readBlobAtRef(fx.root, 'core/v1.0.0', CORE.spec)?.toString() as string,
    )
    expect(archivedCore).not.toContain('tidied')
  })

  test('5. published as an immutable release, fetched and verified into the cache', async () => {
    p.source.publishDir(TAG, staged)
    const result = await fetchReleases(fx.root, p.source, p.cacheDir)
    expect(result).toEqual({ failures: [], verified: [TAG, 'core/v1.0.0'], cached: [] })
  })

  test('6. the site serves the pinned bytes that were staged, verified and recorded', () => {
    const site = join(fx.root, 'site')
    assembleSite({ repoRoot: fx.root, siteDir: site })
    const pinned = readFileSync(join(site, 'component', 'v1.0.0', 'component.schema.json'))
    const asset = readFileSync(join(staged, 'component.schema.json'))
    expect(pinned.equals(asset)).toBe(true)
    expect(sha256(pinned)).toBe(readLedger(fx.root).releases[TAG]?.bundleSha256 as string)
    expect(
      JSON.parse(readFileSync(join(site, 'component', 'v1', 'component.schema.json'), 'utf8')).$id,
    ).toBe('https://specifications.musher.dev/component/v1/component.schema.json')
    expect(verified()).toEqual([])
  })

  test('7. tampered release bytes fail the fetch, and nothing is cached', async () => {
    p.source.setBytes(TAG, 'component.schema.json', '{"tampered":true}\n')
    rmSync(p.cacheDir, { recursive: true, force: true })
    const result = await fetchReleases(fx.root, p.source, p.cacheDir)
    expect(result.failures).toEqual([expect.stringContaining('downloaded with sha256')])
    expect(() => readFileSync(cachedBundlePath(p.cacheDir, TAG))).toThrow()
    expect(() => assembleSite({ repoRoot: fx.root, siteDir: join(fx.root, 'site') })).toThrow(
      /task site:fetch/,
    )
  })

  test('8. feat(core) after the core tag makes the next component record fail', () => {
    fx.writeFile(CORE.spec, '## <a id="scope"></a>1. Core, with a new rule\n')
    fx.commit('feat(core): a new rule')
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { minProperties: 2 }))
    fx.setManifestVersion(COMPONENT.manifestKey, '1.1.0')
    fx.commit('feat(component): component 1.1.0')

    let refusal: unknown
    try {
      record(fx.root)
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(RecordError)
    expect((refusal as Error).message).toContain('feat(core): a new rule')
    expect(readLedger(fx.root).releases['component/v1.1.0']).toBeUndefined()
  })
})
