/**
 * The ledger's two invariants: recording is idempotent, and nothing already
 * recorded may ever change.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertAppendOnly, record, sync } from './ledger.ts'
import { EMPTY_LEDGER, type Ledger, readLedger } from './released.ts'
import { Failures } from './spec.ts'
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
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ 'specifications/component/v1': '1.0.0' })

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
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ 'specifications/component/v1': '0.0.0' })

    expect(record(fx.root).added).toEqual([])
  })

  test('records the source and published hashes separately', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ 'specifications/component/v1': '1.0.0' })
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
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ 'specifications/component/v1': '1.0.0' })
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
})
