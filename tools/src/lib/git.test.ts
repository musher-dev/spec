/**
 * The environment git runs in: neutralised, yet still able to open the
 * repository it was pointed at when another user owns that directory.
 */
import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { FixtureRepo } from '../testing/fixture.ts'
import { git, gitEnvironment } from './git.ts'

describe('gitEnvironment', () => {
  test('ignores the global and system config', () => {
    const env = gitEnvironment('.')
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(env.GIT_CONFIG_SYSTEM).toBe('/dev/null')
  })

  test('trusts exactly the repository it was given', () => {
    const env = gitEnvironment('some/repo')
    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('safe.directory')
    expect(env.GIT_CONFIG_VALUE_0).toBe(resolve('some/repo'))
  })

  test('the trust reaches git, and is the only safe.directory it sees', () => {
    // Ownership cannot be faked without root, so this proves the next best
    // thing: git reads the exception from command scope, where it is honoured.
    const fx = new FixtureRepo()
    try {
      expect(git(fx.root, ['config', '--get-all', 'safe.directory'])).toBe(resolve(fx.root))
    } finally {
      fx.cleanup()
    }
  })
})
