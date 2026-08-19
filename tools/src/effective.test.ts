/**
 * The resolver's three answers — written, defaulted, absent — and the shapes it
 * declines rather than guesses at.
 */
import { describe, expect, test } from 'bun:test'
import { effectiveValue, pointerSegments } from './effective.ts'
import type { Json } from './spec.ts'

const BUNDLE: Json = {
  type: 'object',
  properties: {
    spec: { $ref: '#/$defs/Spec' },
  },
  $defs: {
    Spec: {
      type: 'object',
      properties: {
        health: {
          anyOf: [{ $ref: '#/$defs/Health' }, { type: 'null' }],
          default: null,
        },
        endpoints: { type: 'object', additionalProperties: { $ref: '#/$defs/Endpoint' } },
        tags: { type: 'array', items: { type: 'string', default: 'none' } },
        // Two live branches: a real choice, and not one to guess at.
        either: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
    },
    Health: {
      type: 'object',
      properties: {
        readiness: { anyOf: [{ $ref: '#/$defs/Probe' }, { type: 'null' }], default: null },
      },
    },
    Probe: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        periodSeconds: { type: 'integer', default: 10 },
        timeoutSeconds: { type: 'integer', default: 5 },
      },
    },
    Endpoint: {
      type: 'object',
      properties: { visibility: { type: 'string', default: 'PRIVATE' } },
    },
  },
}

describe('pointerSegments', () => {
  test('splits and unescapes per RFC 6901', () => {
    expect(pointerSegments('/spec/health')).toEqual(['spec', 'health'])
    expect(pointerSegments('')).toEqual([])
    expect(pointerSegments('/a~1b/c~0d')).toEqual(['a/b', 'c~d'])
  })

  test('rejects a string that is not a pointer', () => {
    expect(() => pointerSegments('spec/health')).toThrow()
  })
})

describe('effectiveValue', () => {
  const doc: Json = {
    spec: { health: { readiness: { path: '/healthz' } }, endpoints: { web: {} } },
  }

  test('a written value is written, through two nullable $refs', () => {
    expect(effectiveValue(BUNDLE, doc, '/spec/health/readiness/path')).toEqual({
      kind: 'written',
      value: '/healthz',
    })
  })

  test('an omitted sibling takes the schema default', () => {
    expect(effectiveValue(BUNDLE, doc, '/spec/health/readiness/periodSeconds')).toEqual({
      kind: 'default',
      value: 10,
    })
  })

  test('a typed mapping resolves any key to the same value schema', () => {
    expect(effectiveValue(BUNDLE, doc, '/spec/endpoints/web/visibility')).toEqual({
      kind: 'default',
      value: 'PRIVATE',
    })
  })

  test('an absent ancestor whose default is null has no descendants', () => {
    // The rule ADR 0008 §3 states, and the one a fixture gets wrong: omitting
    // `health` does not confer a probe polling every ten seconds.
    const bare: Json = { spec: {} }
    const result = effectiveValue(BUNDLE, bare, '/spec/health/readiness/periodSeconds')
    expect(result.kind).toBe('absent')
  })

  test('the absent ancestor itself still resolves to its own default', () => {
    expect(effectiveValue(BUNDLE, { spec: {} } as Json, '/spec/health')).toEqual({
      kind: 'default',
      value: null,
    })
  })

  test('a field with neither a value nor a default is absent', () => {
    expect(effectiveValue(BUNDLE, doc, '/spec/health/readiness/nothing').kind).toBe('absent')
  })

  test('a field the schema does not define is absent, not guessed', () => {
    expect(effectiveValue(BUNDLE, doc, '/spec/invented/deeper').kind).toBe('absent')
  })

  test('an ambiguous anyOf is declined rather than picked', () => {
    // Two live branches. Following either would be evaluating the instance,
    // which is the line ADR 0008 §6 draws.
    expect(effectiveValue(BUNDLE, { spec: {} } as Json, '/spec/either/x').kind).toBe('absent')
  })

  test('an array index resolves through items', () => {
    expect(effectiveValue(BUNDLE, { spec: { tags: ['a'] } } as Json, '/spec/tags/0')).toEqual({
      kind: 'written',
      value: 'a',
    })
  })
})
