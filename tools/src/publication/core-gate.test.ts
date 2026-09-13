/**
 * How the core gate classifies a commit, and which commits it reads.
 * `record.test.ts` and `verify.test.ts` exercise the gate itself.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { CORE_FAMILY, familyPaths } from '../lib/layout.ts'
import { FixtureRepo, RELEASE_SECTIONS } from '../testing/fixture.ts'
import { classifyCommit, coreCommitsBetween, releasableTypes } from './core-gate.ts'

const CORE = familyPaths(CORE_FAMILY, 'v1')
const TYPES = new Set(['feat', 'fix', 'docs'])

let repo: FixtureRepo | null = null

function fixture(): FixtureRepo {
  repo = new FixtureRepo()
  return repo
}

afterEach(() => {
  repo?.cleanup()
  repo = null
})

describe('classifyCommit', () => {
  const cases: [string, string, 'releasable' | 'non-releasable'][] = [
    ['feat(core): add a rule', '', 'releasable'],
    ['fix(core): correct a rule', '', 'releasable'],
    ['docs(core): clarify a rule', '', 'releasable'],
    ['feat: unscoped', '', 'releasable'],
    ['refactor(core)!: reshape', '', 'releasable'],
    ['chore!: breaking without a scope', '', 'releasable'],
    ['chore(core): tidy', 'BREAKING CHANGE: a rule moved', 'releasable'],
    ['test(core): cover', 'Some body.\n\nBREAKING-CHANGE: a footer', 'releasable'],
    ['chore(core): tidy', '', 'non-releasable'],
    ['test(core): add a fixture', '', 'non-releasable'],
    ['perf(core): hidden section', '', 'non-releasable'],
    ['refactor(core): reshape', 'mentions BREAKING CHANGE: mid-line only', 'non-releasable'],
    [
      'chore(core): tidy',
      'BREAKING CHANGE: in the first paragraph\n\nThen more prose.',
      'non-releasable',
    ],
    [
      'chore(core): tidy',
      'BREAKING CHANGE: a footer that is not last\nand a line of prose after it',
      'non-releasable',
    ],
    [
      'chore(core): tidy',
      'Body.\n\nBREAKING CHANGE: a rule moved\n  and continues here\nSigned-off-by: A <a@example.invalid>',
      'releasable',
    ],
    ['chore(core): tidy', 'Body.\n\nRelease-As: 1.2.0', 'releasable'],
    ['test(core): cover', 'release-as: 2.0.0\nSigned-off-by: A <a@example.invalid>', 'releasable'],
    ['chore(core): tidy', 'Release-As: 1.2.0\n\nprose after the would-be footer', 'non-releasable'],
    ['chore(core): tidy', 'Signed-off-by: A <a@example.invalid>', 'non-releasable'],
    ['feat(core) add a rule', '', 'non-releasable'],
    ['Merge branch main', 'BREAKING CHANGE: not a conventional header', 'non-releasable'],
  ]
  for (const [subject, body, expected] of cases) {
    test(`${JSON.stringify(subject)}${body === '' ? '' : ' with a body'} is ${expected}`, () => {
      expect(classifyCommit(subject, body, TYPES)).toBe(expected)
    })
  }
})

describe('releasableTypes', () => {
  test('reads the visible changelog sections', () => {
    const fx = fixture()
    fx.writeReleaseConfig()
    expect([...releasableTypes(fx.root)].sort()).toEqual(['docs', 'feat', 'fix'])
  })

  test('a hidden docs section makes docs non-releasable', () => {
    const fx = fixture()
    fx.writeReleaseConfig(
      RELEASE_SECTIONS.map((s) => (s.type === 'docs' ? { ...s, hidden: true } : s)),
    )
    const types = releasableTypes(fx.root)
    expect(classifyCommit('docs(core): clarify', '', types)).toBe('non-releasable')
    expect(classifyCommit('feat(core): add', '', types)).toBe('releasable')
  })

  test('a config without the file fails rather than guessing', () => {
    const fx = fixture()
    expect(() => releasableTypes(fx.root)).toThrow(/is missing/)
  })
})

describe('coreCommitsBetween', () => {
  test('reads only commits touching core, and ignores merges', () => {
    const fx = fixture()
    fx.writeReleaseConfig()
    fx.writeCoreSkeleton('v1')
    fx.commit('feat(core): the base family')
    fx.tag('core/v1.0.0')

    fx.writeFile(familyPaths('component', 'v1').spec, '# component\n')
    fx.commit('feat(component): outside core does not count')

    fx.branch('topic')
    fx.writeFile(CORE.spec, '## <a id="scope"></a>1. Core scope, tidied\n')
    fx.commit('chore(core): tidy')
    fx.checkout('main')
    fx.merge('topic', 'feat(core): a merge commit is never read')

    const commits = coreCommitsBetween(fx.root, 'core/v1.0.0', 'HEAD')
    expect(commits.map((c) => [c.subject, c.class])).toEqual([
      ['chore(core): tidy', 'non-releasable'],
    ])
  })
})
