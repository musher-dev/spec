/**
 * The one thing `check:parity` depends on about another project's CLI: which
 * instances a `validate` run says it rejected.
 *
 * This file exists because that dependency broke silently. Sourcemeta
 * 16.10.0 began printing paths relative to the working directory, every lookup
 * against an absolute path missed, and Blaze appeared to accept all 193
 * subjects — 85 of which Ajv rejects. The check reported disagreements rather
 * than a defect in itself, and its own guard against exactly that did not fire,
 * because the first failure of each batch was still named. Under a name nothing
 * could match.
 */
import { describe, expect, test } from 'bun:test'
import { parseRejections } from './parity.ts'

const CWD = '/repo'
const INSTANCES = ['/repo/conformance/a/case.yaml', '/repo/conformance/b/case.yaml']

describe('parseRejections', () => {
  test('reads an absolute path, as the CLI printed one before 16.10.0', () => {
    const output = [
      'fail: /repo/conformance/a/case.yaml',
      'error: Schema validation failure',
      '  The string value "COMPONENT" was expected to equal the string constant "LISTING"',
    ].join('\n')

    expect([...parseRejections(output, INSTANCES, CWD)]).toEqual(['/repo/conformance/a/case.yaml'])
  })

  test('reads a path relative to the working directory, as 16.10.0 prints one', () => {
    const output = ['fail: conformance/a/case.yaml', 'error: Schema validation failure'].join('\n')

    expect([...parseRejections(output, INSTANCES, CWD)]).toEqual(['/repo/conformance/a/case.yaml'])
  })

  test('reads every failure of a batch, which is what --continue is passed for', () => {
    const output = [
      'fail: conformance/a/case.yaml',
      'error: Schema validation failure',
      'fail: conformance/b/case.yaml',
      'error: Schema validation failure',
      '2 of 2 instances failed',
    ].join('\n')

    expect([...parseRejections(output, INSTANCES, CWD)].sort()).toEqual([
      '/repo/conformance/a/case.yaml',
      '/repo/conformance/b/case.yaml',
    ])
  })

  test('reads a multi-document entry as the file it is an entry of', () => {
    const output = 'fail: conformance/a/case.yaml (entry #2)'

    expect([...parseRejections(output, INSTANCES, CWD)]).toEqual(['/repo/conformance/a/case.yaml'])
  })

  test('an output naming nothing is an empty set, not an error', () => {
    expect(parseRejections('', INSTANCES, CWD).size).toBe(0)
  })

  test('a summary line mentioning a failure is not itself a rejection', () => {
    const output = ['1 of 2 instances failed', 'Stopped at first failure, pass --continue/-c'].join(
      '\n',
    )

    expect(parseRejections(output, INSTANCES, CWD).size).toBe(0)
  })

  test('a name that is not one of the instances asked about throws', () => {
    const output = 'fail: some/other/shape.yaml'

    expect(() => parseRejections(output, INSTANCES, CWD)).toThrow(
      /not one of the instances it was asked about/,
    )
  })
})
