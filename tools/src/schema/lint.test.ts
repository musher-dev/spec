/**
 * The envelope a kind family's root schema must express, and the schema core
 * must not ship.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseBindings } from '../lib/bindings.ts'
import {
  CORE_FAMILY,
  discoverKinds,
  Failures,
  familyPaths,
  isObject,
  type Json,
  rootModulePath,
} from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { checkEnvelope, lintFamilies } from './lint.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

/** Collect failure messages without letting `report` exit the test process. */
function collecting(): { failures: Failures; messages: string[] } {
  const failures = new Failures()
  const messages: string[] = []
  const add = failures.add.bind(failures)
  failures.add = (message: string) => {
    messages.push(message)
    add(message)
  }
  return { failures, messages }
}

function envelope(overrides: { [k: string]: Json } = {}): { [k: string]: Json } {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['specVersion', 'kind', 'metadata', 'spec'],
    properties: {
      specVersion: { type: 'string', enum: ['v1'] },
      kind: { type: 'string', const: 'LISTING' },
      metadata: { type: 'object' },
      spec: { type: 'object' },
    },
    ...overrides,
  }
}

function envelopeProblems(
  doc: { [k: string]: Json },
  bindingsKind: string | null = null,
  major = 'v1',
): string[] {
  const { failures, messages } = collecting()
  const bindings =
    bindingsKind === null
      ? null
      : {
          kind: bindingsKind,
          metadataSection: { number: '3', anchor: 'metadata' },
          nullFields: [],
          itemDocument: 'listing.yaml',
          dependencies: [{ family: 'core', line: 'v1' }],
        }
  checkEnvelope(doc, 'listing.schema.json', { name: 'listing', major }, bindings, failures)
  return messages
}

describe('checkEnvelope', () => {
  test('passes the envelope, with specVersion as a one-value enum or as a const', () => {
    expect(envelopeProblems(envelope())).toEqual([])
    const asConst = envelope()
    ;(asConst.properties as { [k: string]: Json }).specVersion = { type: 'string', const: 'v1' }
    expect(envelopeProblems(asConst)).toEqual([])
  })

  test('passes when the §2 bindings agree on kind', () => {
    expect(envelopeProblems(envelope(), 'LISTING')).toEqual([])
  })

  test('fails when kind disagrees with the §2 bindings, and only then', () => {
    const found = envelopeProblems(envelope(), 'BLUEPRINT')
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('binds "BLUEPRINT"')
  })

  test('fails an extra root property, a missing one, and an optional one', () => {
    const extra = envelope()
    ;(extra.properties as { [k: string]: Json }).apiVersion = { type: 'string' }
    expect(envelopeProblems(extra)[0]).toContain('must declare exactly')

    const optional = envelope({ required: ['specVersion', 'kind', 'metadata'] })
    expect(envelopeProblems(optional)[0]).toContain('must require exactly')
  })

  test('fails an open root', () => {
    expect(envelopeProblems(envelope({ additionalProperties: true }))[0]).toContain(
      '"additionalProperties": false',
    )
  })

  test("fails a specVersion that admits anything but the family's own major", () => {
    const variants: Json[] = [
      { type: 'string', enum: ['v1', 'v2'] },
      { type: 'string', enum: ['v2'] },
      { type: 'string' },
    ]
    for (const specVersion of variants) {
      const doc = envelope()
      ;(doc.properties as { [k: string]: Json }).specVersion = specVersion
      expect(envelopeProblems(doc)[0]).toContain('specVersion must admit exactly "v1"')
    }
    expect(envelopeProblems(envelope(), null, 'v2')[0]).toContain('exactly "v2"')
  })

  test('fails a kind that is not a const', () => {
    const doc = envelope()
    ;(doc.properties as { [k: string]: Json }).kind = { type: 'string', enum: ['LISTING'] }
    expect(envelopeProblems(doc)[0]).toContain('kind must be a string const')
  })

  test("every real kind family's root schema is the envelope", () => {
    const kinds = discoverKinds()
    expect(kinds.length).toBeGreaterThan(0)
    for (const family of kinds) {
      const doc = JSON.parse(readFileSync(rootModulePath(family), 'utf8')) as Json
      if (!isObject(doc)) throw new Error(`${family.name}: root is not an object`)
      const { failures, messages } = collecting()
      const bindings = parseBindings(readFileSync(family.specPath, 'utf8'))
      checkEnvelope(doc, family.name, family, bindings, failures)
      expect(messages).toEqual([])
    }
  })
})

describe('lintFamilies', () => {
  test('skips a schema-less core without a word', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.writeCoreSkeleton('v1')
    const { failures, messages } = collecting()
    expect(lintFamilies(fx.root, failures)).toEqual({ moduleCount: 0, familyCount: 1 })
    expect(messages).toEqual([])
  })

  test('fails a core family version that carries schemas/', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.writeCoreSkeleton('v1')
    fx.writeFile(`${familyPaths(CORE_FAMILY, 'v1').src}/core.schema.json`, '{}\n')
    const { failures, messages } = collecting()
    lintFamilies(fx.root, failures)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('core ships no schema — ADR 0022')
  })

  test('lints a kind root module for its envelope', () => {
    const fx = new FixtureRepo()
    repo = fx
    const doc = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://specifications.musher.dev/listing/v1/listing',
      title: 'Musher Listing Document',
      ...envelope({ additionalProperties: true }),
    }
    fx.writeFile(`${familyPaths('listing', 'v1').src}/listing.schema.json`, JSON.stringify(doc))
    const { failures, messages } = collecting()
    expect(lintFamilies(fx.root, failures).moduleCount).toBe(1)
    expect(messages.some((m) => m.includes('"additionalProperties": false at the root'))).toBe(true)
  })
})
