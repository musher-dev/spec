/**
 * `check:title`: the pull request title against the vocabulary, and the
 * release-please title accepted as configured.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { REPO_ROOT } from '../lib/layout.ts'
import { readVocabulary, titleProblems, type Vocabulary } from './title.ts'

const VOCABULARY: Vocabulary = {
  types: ['feat', 'fix', 'chore', 'docs', 'refactor'],
  scopes: ['core', 'component', 'repo', 'deps'],
  requireScope: false,
}

describe('titleProblems', () => {
  const passes = [
    'refactor(repo): reorganize the repository for its first release',
    'feat(component): add restartPolicy',
    'fix: an unscoped fix',
    'feat(core)!: a breaking change',
    'chore(repo): release component 1.0.0',
    'chore(repo): release core 2.10.3',
    'chore(repo): release 1.0.0',
    'chore(repo): release listing 1.1.0-rc.1',
  ]
  for (const title of passes) {
    test(`accepts ${JSON.stringify(title)}`, () => {
      expect(titleProblems(title, VOCABULARY)).toEqual([])
    })
  }

  const fails: [string, string][] = [
    ['chore(main): release component 1.0.0', 'scope "main"'],
    ['wip(repo): not a type', 'type "wip"'],
    ['feat(component): Capitalised subject', 'must start with a lowercase letter'],
    ['feat(component): ends with a period.', 'must not end with a period'],
    ['Add a thing', 'not a Conventional Commits title'],
    ['feat(component):missing space', 'not a Conventional Commits title'],
  ]
  for (const [title, expected] of fails) {
    test(`rejects ${JSON.stringify(title)}`, () => {
      expect(titleProblems(title, VOCABULARY).join('\n')).toContain(expected)
    })
  }

  test('requireScope refuses an unscoped title', () => {
    expect(titleProblems('fix: unscoped', { ...VOCABULARY, requireScope: true })).toEqual([
      'a scope is required',
    ])
  })
})

describe('readVocabulary', () => {
  test('reads this repository’s conventional-commits.yaml', () => {
    const vocabulary = readVocabulary()
    expect(vocabulary.types).toContain('chore')
    expect(vocabulary.scopes).toContain('repo')
    expect(vocabulary.scopes).not.toContain('main')
    expect(vocabulary.requireScope).toBe(false)
  })
})

describe('the command line', () => {
  const run = (env: { [key: string]: string }) =>
    spawnSync('bun', ['run', join(REPO_ROOT, 'tools', 'src', 'policy', 'title.ts')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
    })

  test('fails when PR_TITLE is unset', () => {
    const result = run({})
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('PR_TITLE is not set')
  })

  test('passes a valid title and fails an invalid one', () => {
    expect(run({ PR_TITLE: 'feat(component): add restartPolicy' }).status).toBe(0)
    expect(run({ PR_TITLE: 'chore(main): release component 1.0.0' }).status).toBe(1)
  })
})
