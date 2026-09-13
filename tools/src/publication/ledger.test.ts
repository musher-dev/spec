/**
 * The ledger's two invariants: recording is idempotent, and nothing already
 * recorded may ever change.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_FAMILY, Failures, familyPaths } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { assertAppendOnly, record, sync } from './ledger.ts'
import { EMPTY_LEDGER, type Ledger, readLedger } from './released.ts'

const COMPONENT_KEY = familyPaths('component', 'v1').manifestKey
const CORE = familyPaths(CORE_FAMILY, 'v1')

let repo: FixtureRepo | null = null

function fixture(): FixtureRepo {
  repo = new FixtureRepo()
  return repo
}

afterEach(() => {
  repo?.cleanup()
  repo = null
})

function problems(base: Ledger, head: Ledger): string[] {
  const failures = new Failures()
  const collected: string[] = []
  const add = failures.add.bind(failures)
  failures.add = (message: string) => {
    collected.push(message)
    add(message)
  }
  assertAppendOnly(base, head, failures)
  return collected
}

describe('record', () => {
  test('is idempotent', () => {
    const fx = fixture()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT_KEY]: '1.0.0' })

    const first = record(fx.root)
    expect(first.added).toEqual(['component/v1.0.0'])
    expect(first.changed).toBe(true)

    const before = readFileSync(join(fx.root, 'published.json'), 'utf8')
    const second = record(fx.root)

    expect(second.added).toEqual([])
    expect(second.changed).toBe(false)
    expect(readFileSync(join(fx.root, 'published.json'), 'utf8')).toBe(before)
  })

  test('ignores the 0.0.0 bootstrap placeholder', () => {
    const fx = fixture()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT_KEY]: '0.0.0' })

    expect(record(fx.root).added).toEqual([])
  })

  test('records the source and published hashes separately', () => {
    const fx = fixture()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT_KEY]: '1.0.0' })
    record(fx.root)

    const entry = readLedger(fx.root).releases['component/v1.0.0']
    expect(entry).toBeDefined()
    // They differ because the pinned copy is restamped with its own `$id`.
    expect(entry?.sourceSha256).not.toBe(entry?.publishedSha256)
  })
})

describe('sync', () => {
  test('backfills a tag that was never recorded', () => {
    const fx = fixture()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT_KEY]: '1.0.0' })
    fx.commit('chore: release without recording')
    fx.tag('component/v1.0.0')

    expect(sync(fx.root).added).toEqual(['component/v1.0.0'])
    expect(readLedger(fx.root).releases['component/v1.0.0']).toBeDefined()
  })
})

describe('assertAppendOnly', () => {
  const entry = { path: 'a.json', sourceSha256: 'a'.repeat(64), publishedSha256: 'b'.repeat(64) }
  const base: Ledger = { version: 1, releases: { 'component/v1.0.0': entry } }

  test('accepts an addition', () => {
    const head: Ledger = {
      version: 1,
      releases: { ...base.releases, 'component/v1.1.0': entry },
    }
    expect(problems(base, head)).toEqual([])
  })

  test('rejects a removal', () => {
    expect(problems(base, EMPTY_LEDGER)[0]).toContain('cannot be unpublished')
  })

  test('rejects a modification', () => {
    const head: Ledger = {
      version: 1,
      releases: { 'component/v1.0.0': { ...entry, sourceSha256: 'c'.repeat(64) } },
    }
    expect(problems(base, head)[0]).toContain('is immutable')
  })

  describe('a schema-less release (interim, until ledger v2)', () => {
    test('record writes the family version directory and null hashes, without a bundle', () => {
      const fx = fixture()
      fx.writeCoreSkeleton('v1')
      fx.setManifest({ [CORE.manifestKey]: '1.0.0' })

      expect(record(fx.root).added).toEqual(['core/v1.0.0'])
      expect(readLedger(fx.root).releases['core/v1.0.0']).toEqual({
        path: CORE.dir,
        sourceSha256: null,
        publishedSha256: null,
      })
      const text = readFileSync(join(fx.root, 'published.json'), 'utf8')
      expect(text).toContain('"sourceSha256": null')
      // Idempotent, like every other entry.
      expect(record(fx.root).changed).toBe(false)
    })

    test('record refuses a core release whose family version does not exist', () => {
      const fx = fixture()
      fx.setManifest({ [CORE.manifestKey]: '1.0.0' })
      expect(() => record(fx.root)).toThrow(/cannot record/)
    })

    test('sync backfills a core tag without loading a bundle', () => {
      const fx = fixture()
      fx.writeCoreSkeleton('v1')
      fx.commit('feat(core): unrecorded')
      fx.tag('core/v1.0.0')
      expect(sync(fx.root).added).toEqual(['core/v1.0.0'])
      expect(readLedger(fx.root).releases['core/v1.0.0']?.sourceSha256).toBeNull()
    })

    test('neither entry form can stand in for the other', () => {
      const fx = fixture()
      const hashed = {
        path: CORE.dir,
        sourceSha256: 'a'.repeat(64),
        publishedSha256: 'b'.repeat(64),
      }
      fx.setLedger({ version: 1, releases: { 'core/v1.0.0': hashed } })
      expect(() => readLedger(fx.root)).toThrow(/ships no schema/)

      const withoutHashes = { path: COMPONENT_KEY, sourceSha256: null, publishedSha256: null }
      fx.setLedger({ version: 1, releases: { 'component/v1.0.0': withoutHashes } })
      expect(() => readLedger(fx.root)).toThrow(/must carry/)
    })

    test('a recorded core entry is as immutable as any other', () => {
      const entry = { path: CORE.dir, sourceSha256: null, publishedSha256: null }
      const base: Ledger = { version: 1, releases: { 'core/v1.0.0': entry } }
      const moved: Ledger = { version: 1, releases: { 'core/v1.0.0': { ...entry, path: 'x' } } }
      expect(problems(base, base)).toEqual([])
      expect(problems(base, moved)[0]).toContain('is immutable')
    })
  })
})
