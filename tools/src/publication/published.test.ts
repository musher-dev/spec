/**
 * The verification rules that make a tag and the ledger agree, or fail loudly.
 *
 * Each test states one of the three states in `verifyPublications`: a recorded
 * release whose tag still holds the bytes, a recorded release whose tag does not
 * exist yet (a release pull request mid-flight), and a tag nobody recorded.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_FAMILY, Failures, familyPaths } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { record } from './ledger.ts'
import { verifyPublications } from './released.ts'

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

/** Collect failure messages without letting `report` exit the test process. */
function problems(root: string): string[] {
  const failures = new Failures()
  const collected: string[] = []
  const add = failures.add.bind(failures)
  failures.add = (message: string) => {
    collected.push(message)
    add(message)
  }
  verifyPublications(root, failures)
  return collected
}

function release(fx: FixtureRepo, version: string, doc: unknown) {
  fx.writeBundle('component', 'v1', doc as never)
  fx.setManifest({ [COMPONENT_KEY]: version })
  record(fx.root)
  fx.commit(`chore: release component ${version}`)
  fx.tag(`component/v${version}`)
}

describe('verifyPublications', () => {
  test('a recorded release whose tag still holds its bytes passes', () => {
    const fx = fixture()
    release(fx, '1.0.0', fx.bundleDoc('component', 'v1'))
    expect(problems(fx.root)).toEqual([])
  })

  test('a tag with no ledger entry fails', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT_KEY]: '1.0.0' })
    fx.commit('chore: release without recording')
    fx.tag('component/v1.0.0')

    const found = problems(fx.root)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('is tagged but absent from published.json')
  })

  test('an edited ledger hash fails', () => {
    const fx = fixture()
    release(fx, '1.0.0', fx.bundleDoc('component', 'v1'))

    const path = join(fx.root, 'published.json')
    const ledger = JSON.parse(readFileSync(path, 'utf8'))
    ledger.releases['component/v1.0.0'].sourceSha256 = 'f'.repeat(64)
    writeFileSync(path, JSON.stringify(ledger, null, 2))

    const found = problems(fx.root)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('A released version has been altered')
  })

  test('a pending release — entry, no tag, manifest agrees — passes', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT_KEY]: '1.0.0' })
    record(fx.root)
    fx.commit('chore(main): release component 1.0.0')
    // No tag: this is the state of the release pull request before merge.

    expect(problems(fx.root)).toEqual([])
  })

  test('a pending entry whose manifest disagrees fails', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT_KEY]: '1.0.0' })
    record(fx.root)
    fx.setManifest({ [COMPONENT_KEY]: '1.2.0' })
    fx.commit('chore: manifest moved out from under the entry')

    const found = problems(fx.root)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('only valid while its release is pending')
  })

  test('a pending entry whose working-tree bytes changed fails', () => {
    const fx = fixture()
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifest({ [COMPONENT_KEY]: '1.0.0' })
    record(fx.root)
    fx.writeBundle('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'changed' }))
    fx.commit('feat(component): edited after recording')

    const found = problems(fx.root)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('Re-run `task ledger:record`')
  })

  test('an empty repository verifies as clean', () => {
    const fx = fixture()
    expect(problems(fx.root)).toEqual([])
  })

  describe('verifyPublications for a schema-less release (interim, until ledger v2)', () => {
    test('a recorded and tagged core release verifies without a bundle', () => {
      const fx = fixture()
      fx.writeCoreSkeleton('v1')
      fx.setManifest({ [CORE.manifestKey]: '1.0.0' })
      record(fx.root)
      fx.commit('chore: release core 1.0.0')
      fx.tag('core/v1.0.0')
      expect(problems(fx.root)).toEqual([])
    })

    test('a pending core release verifies against the manifest and the working tree', () => {
      const fx = fixture()
      fx.writeCoreSkeleton('v1')
      fx.setManifest({ [CORE.manifestKey]: '1.0.0' })
      record(fx.root)
      fx.commit('chore(main): release core 1.0.0')
      expect(problems(fx.root)).toEqual([])

      fx.setManifest({ [CORE.manifestKey]: '1.1.0' })
      fx.commit('chore: manifest moved')
      expect(problems(fx.root)[0]).toContain('only valid while its release is pending')
    })

    test('a core entry naming a path its tag does not carry fails', () => {
      const fx = fixture()
      fx.writeCoreSkeleton('v1')
      fx.setLedger({
        version: 1,
        releases: {
          'core/v1.0.0': { path: `${CORE.dir}-moved`, sourceSha256: null, publishedSha256: null },
        },
      })
      fx.commit('chore: release core 1.0.0 with a wrong path')
      fx.tag('core/v1.0.0')
      const found = problems(fx.root)
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('does not exist at that tag')
    })

    test('an untagged, unrecorded core tag is still a failure', () => {
      const fx = fixture()
      fx.writeCoreSkeleton('v1')
      fx.commit('feat(core): tagged outside the flow')
      fx.tag('core/v1.0.0')
      expect(problems(fx.root)[0]).toContain('is tagged but absent from published.json')
    })
  })
})
