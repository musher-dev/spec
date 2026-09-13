/**
 * The compatibility replay must replay something.
 *
 * It reads each release's examples and conformance corpus out of the tag. Read
 * at a path the tag does not carry, that corpus is empty, the replay checks
 * zero documents, and the gate reports that nothing regressed. These tests hold
 * that a missing corpus is a failure instead.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { discoverFamilies, Failures, familyPaths, LayoutError } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { replayRelease } from './compat.ts'
import { record } from './ledger.ts'
import { discoverReleases } from './released.ts'

const COMPONENT = familyPaths('component', 'v1')

let repo: FixtureRepo | null = null

function fixture(): FixtureRepo {
  repo = new FixtureRepo()
  return repo
}

afterEach(() => {
  repo?.cleanup()
  repo = null
})

/** Release component 1.0.0, optionally without one of its parts. */
function cut(fx: FixtureRepo, without?: 'examples' | 'conformance'): void {
  fx.writeFamilySkeleton('component', 'v1')
  if (without !== undefined) fx.remove(COMPONENT[without])
  fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
  fx.setManifest({ [COMPONENT.manifestKey]: '1.0.0' })
  record(fx.root)
  fx.commit('chore: release component 1.0.0')
  fx.tag('component/v1.0.0')
}

function replay(fx: FixtureRepo, failures: Failures): number {
  const [family] = discoverFamilies(fx.root)
  const [release] = discoverReleases(fx.root)
  if (family === undefined || release === undefined) throw new Error('fixture has no release')
  return replayRelease(fx.root, family, release, failures)
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
    const fx = fixture()
    cut(fx)
    const failures = new Failures()
    expect(replay(fx, failures)).toBe(1)
    expect(failures.count).toBe(0)
  })

  for (const part of ['examples', 'conformance'] as const) {
    test(`a release tag lacking its ${part} throws rather than replaying nothing`, () => {
      const fx = fixture()
      cut(fx, part)
      const error = thrown(() => replay(fx, new Failures()))
      expect(error).toBeInstanceOf(LayoutError)
      expect((error as Error).message).toContain('component/v1.0.0')
      expect((error as Error).message).toContain(COMPONENT[part])
    })
  }
})
