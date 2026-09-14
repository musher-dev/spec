/**
 * Build output must never be tracked, wherever it would be written.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { CATALOG_FILE, CATALOG_NAME, familyPaths } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { trackedBuildOutput } from './generated.ts'

const COMPONENT = familyPaths('component', 'v1')

let repo: FixtureRepo | null = null

function fixture(): FixtureRepo {
  repo = new FixtureRepo()
  repo.writeSources('component', 'v1', repo.bundleDoc('component', 'v1'))
  repo.writeFile('README.md', '# fixture\n')
  return repo
}

afterEach(() => {
  repo?.cleanup()
  repo = null
})

describe('trackedBuildOutput', () => {
  test('a tree of sources alone is clean, and so is untracked output', () => {
    const fx = fixture()
    fx.commit('feat(component): sources')
    fx.writeFile(COMPONENT.bundle, '{}\n')
    fx.writeFile(CATALOG_FILE, '{}\n')
    expect(trackedBuildOutput(fx.root)).toEqual([])
  })

  test('a tracked dist/ bundle fails', () => {
    const fx = fixture()
    fx.writeFile(COMPONENT.bundle, '{}\n')
    fx.writeFile(CATALOG_FILE, '{}\n')
    fx.commit('build: commit build output')
    expect(trackedBuildOutput(fx.root)).toEqual([CATALOG_FILE, COMPONENT.bundle])
  })

  test('a bundle at the legacy schemas/dist path, or a root catalog, fails', () => {
    const fx = fixture()
    const legacy = `${COMPONENT.schemas}/dist/component.schema.json`
    fx.writeFile(legacy, '{}\n')
    fx.writeFile(CATALOG_NAME, '{}\n')
    fx.commit('build: resurrect the old layout')
    expect(trackedBuildOutput(fx.root)).toEqual([CATALOG_NAME, legacy])
  })

  test('a catalog.json below the root is not build output', () => {
    const fx = fixture()
    fx.writeFile(`docs/${CATALOG_NAME}`, '{}\n')
    fx.commit('docs: an unrelated file that shares the name')
    expect(trackedBuildOutput(fx.root)).toEqual([])
  })
})
