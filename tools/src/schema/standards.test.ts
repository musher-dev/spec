/**
 * `check:standards` and `check:parity` skip locally without the jsonschema
 * CLI, and fail in CI, where a skip would pass a gate that never ran.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { REPO_ROOT } from '../lib/layout.ts'
import { absentCliIsFailure } from './standards.ts'

describe('absentCliIsFailure', () => {
  test('CI=true makes an absent CLI a failure', () => {
    expect(absentCliIsFailure({ CI: 'true' })).toBe(true)
  })

  test('anywhere else it is a skip', () => {
    expect(absentCliIsFailure({})).toBe(false)
    expect(absentCliIsFailure({ CI: '' })).toBe(false)
    expect(absentCliIsFailure({ CI: 'false' })).toBe(false)
  })
})

describe('reportAbsentCli', () => {
  const script = [
    `import { reportAbsentCli } from ${JSON.stringify(join(REPO_ROOT, 'tools', 'src', 'schema', 'standards.ts'))}`,
    "reportAbsentCli('check:parity', '/nowhere/jsonschema')",
    "console.log('returned')",
  ].join('\n')
  const run = (env: { [key: string]: string }) =>
    spawnSync('bun', ['-e', script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
    })

  test('exits 1 under CI=true', () => {
    const result = run({ CI: 'true' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('check:parity cannot be skipped in CI')
    expect(result.stdout).not.toContain('returned')
  })

  test('returns with a skip notice locally', () => {
    const result = run({})
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('check:parity skipped, not passed')
    expect(result.stdout).toContain('returned')
  })
})
