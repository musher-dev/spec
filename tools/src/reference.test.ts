/**
 * The reference model loses nothing, and says so where it cannot.
 *
 * Each case here is a construct that appears in a real bundle, written as the
 * subtree it appears as, so a failure names something a reader can go and look
 * at. The last block runs against the three published bundles: it is the drift
 * guard, and a construct entering the contract that this reader has no case for
 * fails there rather than shipping a page that omits whatever it meant.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { buildReference, type Shape } from './reference.ts'
import { discoverFamilies, type Json } from './spec.ts'

function model(defs: { [k: string]: Json }, root: { [k: string]: Json } = {}) {
  return buildReference(
    { $schema: 'x', $id: 'y', title: 'T', type: 'object', $defs: defs, ...root },
    'component',
    'v1',
  )
}

function field(defs: { [k: string]: Json }, type: string, name: string) {
  const found = model(defs)
    .types.find((t) => t.name === type)
    ?.fields.find((f) => f.name === name)
  if (found === undefined) throw new Error(`no ${type}.${name}`)
  return found
}

/**
 * `then` written as a computed key throughout: it is a JSON Schema keyword here,
 * but a static `then` property trips biome's noThenProperty, which exists to
 * catch an accidental thenable. The keyword is the point in a schema fixture.
 */
const THEN = 'then'

/** A one-type bundle whose single field carries `schema`. */
function withField(schema: Json, extra: { [k: string]: Json } = {}) {
  return { T: { type: 'object', additionalProperties: false, properties: { f: schema }, ...extra } }
}

describe('nullable fields', () => {
  test('is decided by a null branch, not by branch count', () => {
    const f = field(withField({ anyOf: [{ type: 'string' }, { type: 'null' }] }), 'T', 'f')
    expect(f.nullable).toBe(true)
    expect(f.shape).toEqual({ kind: 'scalar', type: 'string' })
  })

  test('two live branches with no null branch are an alternation, not nullable', () => {
    const f = field(
      withField({ anyOf: [{ pattern: '^a' }, { pattern: '^b' }], type: 'string', maxLength: 256 }),
      'T',
      'f',
    )
    expect(f.nullable).toBe(false)
    expect(f.shape.kind).toBe('alternation')
  })

  test('a sibling assertion beside anyOf survives as a constraint', () => {
    const f = field(
      withField({ anyOf: [{ pattern: '^a' }, { pattern: '^b' }], type: 'string', maxLength: 256 }),
      'T',
      'f',
    )
    expect(f.constraints).toEqual([{ name: 'maxLength', value: 256 }])
  })

  test('three branches including null are nullable and still a union of two', () => {
    const f = field(
      withField({ anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] }),
      'T',
      'f',
    )
    expect(f.nullable).toBe(true)
    expect(f.shape.kind).toBe('alternation')
  })
})

describe('discriminated unions', () => {
  const defs = (mapping: { [k: string]: Json }) => ({
    A: { type: 'object', additionalProperties: false, properties: {} },
    B: { type: 'object', additionalProperties: false, properties: {} },
    T: {
      type: 'object',
      additionalProperties: false,
      properties: {
        f: {
          oneOf: [{ $ref: '#/$defs/A' }, { $ref: '#/$defs/B' }],
          'x-musher-discriminator': { propertyName: 'type', mapping },
        },
      },
    },
  })

  test('resolves by pointer, so mapping order cannot mislabel a branch', () => {
    // The real ComponentEnvVar.value: oneOf is [Literal, ConfigRef] while the
    // canonicalized mapping is {CONFIG_REF, LITERAL}. Zipping would swap them.
    const forward = field(defs({ FIRST: '#/$defs/A', SECOND: '#/$defs/B' }), 'T', 'f')
    const reversed = field(defs({ SECOND: '#/$defs/B', FIRST: '#/$defs/A' }), 'T', 'f')
    const expected = [
      { label: 'FIRST', target: 'A' },
      { label: 'SECOND', target: 'B' },
    ]
    expect((forward.shape as Extract<Shape, { kind: 'union' }>).discriminator?.branches).toEqual(
      expected,
    )
    expect((reversed.shape as Extract<Shape, { kind: 'union' }>).discriminator?.branches).toEqual(
      expected,
    )
  })

  test('a mapping naming a missing definition throws', () => {
    expect(() => field(defs({ FIRST: '#/$defs/Nope' }), 'T', 'f')).toThrow(/missing \$defs\/Nope/)
  })
})

describe('maps', () => {
  test('takes its key name from the resolved value type, not the map property', () => {
    const f = field(
      {
        V: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          'x-additionalPropertiesName': 'endpointName',
        },
        T: {
          type: 'object',
          additionalProperties: false,
          properties: {
            f: {
              type: 'object',
              additionalProperties: { $ref: '#/$defs/V' },
              propertyNames: { pattern: '^[a-z]+$' },
            },
          },
        },
      },
      'T',
      'f',
    )
    expect(f.shape).toMatchObject({
      kind: 'map',
      keyName: 'endpointName',
      named: true,
      keyPattern: '^[a-z]+$',
    })
  })

  test('an unannotated value type falls back and is reported, not dropped', () => {
    const built = model({
      V: { type: 'object', additionalProperties: false, properties: {} },
      T: {
        type: 'object',
        additionalProperties: false,
        properties: { f: { type: 'object', additionalProperties: { $ref: '#/$defs/V' } } },
      },
    })
    const f = built.types.find((t) => t.name === 'T')?.fields[0]
    expect(f?.shape).toMatchObject({ kind: 'map', named: false })
    expect(built.notes.join()).toContain('map key unnamed')
  })

  test('additionalProperties:false is a closed record, never a map', () => {
    const built = model({ T: { type: 'object', additionalProperties: false, properties: {} } })
    expect(built.types[0]?.closed).toBe(true)
  })

  test('additionalProperties inside a negation is not a map', () => {
    // The real ComponentWorkload/allOf/4/if/.../not: it declares no `type`, so
    // requiring type:"object" keeps it out of the map path.
    const built = model({
      T: {
        type: 'object',
        additionalProperties: false,
        properties: { f: { type: 'object' } },
        allOf: [
          {
            if: {
              properties: { f: { not: { additionalProperties: { not: { properties: {} } } } } },
              required: ['f'],
            },
            [THEN]: { required: ['f'] },
          },
        ],
      },
    })
    expect(built.types[0]?.conditions).toHaveLength(1)
    // The property under test: the negation subtree produced no map anywhere.
    expect(JSON.stringify(built)).not.toContain('"kind":"map"')
    expect(built.notes).toEqual([])
  })
})

describe('conditionals', () => {
  test('the false subschema reads as forbidden, and its else as required', () => {
    const built = model({
      T: {
        type: 'object',
        additionalProperties: false,
        properties: { a: { type: 'string' }, b: { type: 'integer' } },
        if: { properties: { a: { pattern: '^\\.' } }, required: ['a'] },
        [THEN]: { properties: { b: false } },
        else: { required: ['b'] },
      },
    })
    const condition = built.types[0]?.conditions[0]
    expect(condition?.when.kind).toBe('pattern')
    expect(condition?.consequent).toEqual([{ field: 'b', detail: 'must not be present' }])
    expect(condition?.alternative).toEqual([{ field: 'b', detail: 'is required' }])
  })

  test('a $ref narrowed by a sibling required reports both halves', () => {
    const built = model({
      P: { type: 'object', additionalProperties: false, properties: {} },
      T: {
        type: 'object',
        additionalProperties: false,
        properties: { h: { $ref: '#/$defs/P' }, k: { type: 'string' } },
        allOf: [
          {
            if: { properties: { k: { const: 'X' } }, required: ['k'] },
            [THEN]: {
              properties: { h: { $ref: '#/$defs/P', required: ['readiness'] } },
              required: ['h'],
            },
          },
        ],
      },
    })
    const detail = built.types.find((t) => t.name === 'T')?.conditions[0]?.consequent[0]?.detail
    expect(detail).toContain('is a P')
    expect(detail).toContain('`readiness` required')
    expect(detail).toContain('is required')
  })

  test('a condition it cannot phrase is opaque and keeps its comment', () => {
    const built = model({
      T: {
        type: 'object',
        additionalProperties: false,
        properties: { f: { type: 'object' } },
        allOf: [
          {
            $comment: 'why this shape',
            if: { not: { properties: {} } },
            [THEN]: { required: ['f'] },
          },
        ],
      },
    })
    expect(built.types[0]?.conditions[0]?.when.kind).toBe('opaque')
    expect(built.types[0]?.conditions[0]?.comment).toBe('why this shape')
  })
})

describe('refusals and totality', () => {
  test('an unhandled keyword throws by name', () => {
    expect(() => model(withField({ type: 'array', prefixItems: [{ type: 'string' }] }))).toThrow(
      /declares "prefixItems"/,
    )
  })

  test('an array type throws rather than being guessed at', () => {
    expect(() => model(withField({ type: ['string', 'null'] }))).toThrow(/array "type"/)
  })

  test('a title below the root is ignored, not rendered', () => {
    const f = field(withField({ type: 'string', title: 'Restated Key' }), 'T', 'f')
    expect(JSON.stringify(f)).not.toContain('Restated Key')
  })

  test('is total on the bundle shape the test fixture writes', () => {
    const built = buildReference(
      { $schema: 'x', $id: 'y', title: 'Musher component Document', type: 'object' },
      'component',
      'v1',
    )
    expect(built.types).toHaveLength(0)
    expect(built.root.fields).toHaveLength(0)
    expect(built.title).toBe('Musher component Document')
  })

  test('a documented null default is a value, not an absence', () => {
    const f = field(
      withField({ anyOf: [{ type: 'string' }, { type: 'null' }], default: null }),
      'T',
      'f',
    )
    expect(f.documented).toEqual({ value: null })
  })

  test('a field with no default carries none', () => {
    expect(field(withField({ type: 'string' }), 'T', 'f').documented).toBeUndefined()
  })
})

describe('what the model refuses or keeps', () => {
  test('every enum member survives, whatever its type', () => {
    const f = field(withField({ type: 'string', enum: ['A', 1, null, 'B'] }), 'T', 'f')
    expect(f.shape).toEqual({ kind: 'enum', type: 'string', values: ['A', 1, null, 'B'] })
  })

  test('an untyped enum is not relabelled as a string', () => {
    const f = field(withField({ enum: [1, 2] }), 'T', 'f')
    expect(f.shape).toEqual({ kind: 'enum', type: undefined, values: [1, 2] })
  })

  for (const keyword of ['allOf', 'not', 'if', 'properties']) {
    test(`${keyword} in shape position is refused, not rendered as an untyped value`, () => {
      // Legitimate inside a conditional, where predicateOf and effectsOf read
      // it; meaningless here, and returning `any` would drop a whole type.
      expect(() => model(withField({ type: 'object', [keyword]: {} }))).toThrow(
        new RegExp(`carries "${keyword}" where a shape is expected`),
      )
    })
  }

  test('a note from the root type is recorded once, not twice', () => {
    const built = buildReference(
      {
        $schema: 'x',
        $id: 'y',
        title: 'T',
        type: 'object',
        additionalProperties: false,
        properties: { m: { type: 'object', additionalProperties: { type: 'string' } } },
      },
      'component',
      'v1',
    )
    expect(built.notes).toHaveLength(1)
  })
})

describe('determinism', () => {
  test('types come out sorted however they went in', () => {
    const forward = model({ A: { type: 'object' }, B: { type: 'object' }, C: { type: 'object' } })
    const reverse = model({ C: { type: 'object' }, B: { type: 'object' }, A: { type: 'object' } })
    expect(forward.types.map((t) => t.name)).toEqual(['A', 'B', 'C'])
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse))
  })
})

describe('the published bundles', () => {
  const families = discoverFamilies()

  for (const family of families) {
    const bundle = JSON.parse(readFileSync(family.bundlePath, 'utf8')) as Json

    test(`${family.name}: builds, with every construct accounted for`, () => {
      const built = buildReference(bundle, family.name, family.major)
      expect(built.types.length + built.root.fields.length).toBeGreaterThan(0)
    })

    test(`${family.name}: every opaque condition carries the comment explaining it`, () => {
      const built = buildReference(bundle, family.name, family.major)
      for (const type of built.types) {
        for (const condition of type.conditions) {
          if (condition.when.kind !== 'opaque') continue
          // The only readable form of a condition no phrasing does justice to.
          expect(condition.comment).toBeString()
        }
      }
    })
  }

  test('every map in every bundle names its key', () => {
    // The reference falls back to a generic label rather than failing, so
    // without this a newly added map would quietly ship a page saying `name`.
    const notes = families.flatMap(
      (family) =>
        buildReference(
          JSON.parse(readFileSync(family.bundlePath, 'utf8')) as Json,
          family.name,
          family.major,
        ).notes,
    )
    expect(notes).toEqual([])
  })
})
