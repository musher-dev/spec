/**
 * The compatibility replay must replay something.
 *
 * It reads each release's examples and conformance corpus out of the tag, under
 * the ledger's path. Read at a path the tag does not carry, that corpus is
 * empty, the replay checks zero documents, and the gate reports that nothing
 * regressed. These tests hold that a missing corpus is a failure instead.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { discoverKinds, Failures, familyPaths, LayoutError } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { Pipeline } from '../testing/pipeline.ts'
import { replayAll, replayRelease } from './compat.ts'
import { readLedger, taggedEntries } from './ledger.ts'

const COMPONENT = familyPaths('component', 'v1')

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

/** Release component 1.0.0 to its tag, optionally without one of its parts. */
function cut(without?: 'examples' | 'conformance'): FixtureRepo {
  const fx = new FixtureRepo()
  repo = fx
  const p = new Pipeline(fx)
  p.releaseCore('1.0.0')
  fx.writeFamilySkeleton('component', 'v1')
  if (without !== undefined) fx.remove(COMPONENT[without])
  p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'), {
    skeleton: false,
    publish: false,
  })
  return fx
}

function replay(fx: FixtureRepo, failures: Failures): number {
  const family = discoverKinds(fx.root).find((f) => f.name === 'component')
  const recorded = taggedEntries(fx.root, readLedger(fx.root)).find(
    (r) => r.release.family === 'component',
  )
  if (family === undefined || recorded === undefined) throw new Error('fixture has no release')
  return replayRelease(fx.root, family, recorded, failures)
}

function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe('replayRelease', () => {
  test("replays a release's examples from its tag", () => {
    const fx = cut()
    const failures = new Failures()
    expect(replay(fx, failures)).toBe(1)
    expect(failures.count).toBe(0)
  })

  for (const part of ['examples', 'conformance'] as const) {
    test(`a release tag lacking its ${part} throws rather than replaying nothing`, () => {
      const fx = cut(part)
      const error = thrown(() => replay(fx, new Failures()))
      expect(error).toBeInstanceOf(LayoutError)
      expect((error as Error).message).toContain('component/v1.0.0')
      expect((error as Error).message).toContain(COMPONENT[part])
    })
  }

  describe('replayAll', () => {
    test('skips a core release, which accepted no document a schema decided', () => {
      const fx = new FixtureRepo()
      repo = fx
      new Pipeline(fx).releaseCore('1.0.0')
      const failures = new Failures()
      expect(replayAll(fx.root, failures)).toEqual({ replayed: 0, checked: 0 })
      expect(failures.count).toBe(0)
    })

    test('still replays a kind release beside a core one', () => {
      const fx = cut()
      const failures = new Failures()
      expect(replayAll(fx.root, failures)).toEqual({ replayed: 1, checked: 1 })
      expect(failures.count).toBe(0)
    })
  })
})
