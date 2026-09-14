/**
 * The runner resolves a corpus's registry through the §2 dependency table, runs
 * the core corpus through the parser alone, and holds each case's `clause` and
 * `requirements` to the same rules.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_FAMILY, canonicalJson, Failures, type Family, familyPaths } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import {
  type CaseMetadata,
  type Context,
  checkClauseConsistency,
  loadContext,
  runConformance,
} from './conformance.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

function fixture(): FixtureRepo {
  repo = new FixtureRepo()
  return repo
}

type Row = readonly [code: string, phase: string]

function diagnosticsTable(rows: readonly Row[]): string[] {
  return [
    '## <a id="diagnostics"></a>7. Diagnostics',
    '',
    '| Code | Phase | Meaning |',
    '|---|---|---|',
    ...rows.map(([code, phase]) => `| \`${code}\` | \`${phase}\` | A condition. |`),
    '',
  ]
}

const CORE_SPEC = [
  '# Musher Document Core Specification',
  '',
  '## <a id="envelope"></a>2. Document envelope',
  '',
  '<a id="CORE-ENV-002"></a>`kind` is the constant the family binds.',
  '',
  '## <a id="validation-layers"></a>6. Validation layers',
  '',
  '### <a id="yaml-profile"></a>6.1 The Musher YAML profile',
  '',
  '<a id="CORE-YAML-006"></a>A mapping key appears once.',
  '',
  ...diagnosticsTable([
    ['ERR_DUPLICATE_KEY', 'parser'],
    ['ERR_WRONG_KIND', 'structural'],
  ]),
].join('\n')

/** A kind family's spec, with §2 written as the docs/adr/0022 template writes it. */
function kindSpec(options: {
  name: string
  dependencies?: readonly string[]
  rows?: readonly Row[]
  bindings?: boolean
}): string {
  const upper = options.name.toUpperCase()
  const dependencies = options.dependencies ?? [CORE_FAMILY]
  const envelope =
    options.bindings === false
      ? ['## <a id="envelope"></a>2. Document envelope', '', 'No tables yet.', '']
      : [
          '## <a id="envelope"></a>2. Document envelope',
          '',
          '| Core parameter | This family |',
          '|---|---|',
          `| \`kind\` | \`${upper}\` |`,
          '| `metadata` | [§3](#metadata) |',
          '| Fields accepting `null` | none |',
          '| Item document | No — it sits inside an item |',
          '',
          '**Normative dependencies**',
          '',
          '| Specification | Line |',
          '|---|---|',
          ...dependencies.map((d) => `| [${d}](../../${d}/v1/spec.md) | v1 |`),
          '',
        ]
  return [
    `# Musher ${options.name} Specification`,
    '',
    ...envelope,
    '## <a id="metadata"></a>3. Metadata',
    '',
    `<a id="${upper}-META-001"></a>A metadata rule.`,
    '',
    ...diagnosticsTable(options.rows ?? [[`ERR_${upper}_THING`, 'semantic']]),
  ].join('\n')
}

/** A `clause` value, spelled through the layout module rather than as a path literal. */
function clauseOf(name: string, anchor: string): string {
  return `${familyPaths(name, 'v1').spec}#${anchor}`
}

function writeCore(fx: FixtureRepo, prose = CORE_SPEC): void {
  fx.writeFile(familyPaths(CORE_FAMILY, 'v1').spec, prose)
}

function writeKind(fx: FixtureRepo, options: Parameters<typeof kindSpec>[0]): void {
  fx.writeFile(familyPaths(options.name, 'v1').spec, kindSpec(options))
}

function family(context: Context, name: string): Family {
  const found = context.families.find((f) => f.name === name)
  if (found === undefined) throw new Error(`no ${name} family in the fixture`)
  return found
}

function registryOf(context: Context, name: string): Map<string, string> {
  return new Map(context.reach.get(`${name}/v1`)?.registry)
}

describe('diagnostic registries', () => {
  test("a kind family reaches its own table, core's, and each declared dependency's", () => {
    const fx = fixture()
    writeCore(fx)
    writeKind(fx, { name: 'alpha' })
    writeKind(fx, { name: 'beta', dependencies: [CORE_FAMILY, 'alpha'] })

    const failures = new Failures()
    const context = loadContext(fx.root, failures)
    expect(failures.messages).toEqual([])

    expect(registryOf(context, 'beta')).toEqual(
      new Map([
        ['ERR_DUPLICATE_KEY', 'parser'],
        ['ERR_WRONG_KIND', 'structural'],
        ['ERR_ALPHA_THING', 'semantic'],
        ['ERR_BETA_THING', 'semantic'],
      ]),
    )
    // A dependency is one-way: alpha declares none on beta.
    expect(registryOf(context, 'alpha').has('ERR_BETA_THING')).toBe(false)
    expect(registryOf(context, 'alpha').has('ERR_DUPLICATE_KEY')).toBe(true)
  })

  test("core's registry is core's table only", () => {
    const fx = fixture()
    writeCore(fx)
    writeKind(fx, { name: 'alpha' })

    const context = loadContext(fx.root, new Failures())
    expect([...registryOf(context, CORE_FAMILY).keys()].sort()).toEqual([
      'ERR_DUPLICATE_KEY',
      'ERR_WRONG_KIND',
    ])
  })

  test('a kind family re-declaring a core code fails', () => {
    const fx = fixture()
    writeCore(fx)
    writeKind(fx, {
      name: 'alpha',
      rows: [
        ['ERR_ALPHA_THING', 'semantic'],
        ['ERR_DUPLICATE_KEY', 'parser'],
      ],
    })

    const failures = new Failures()
    loadContext(fx.root, failures)
    expect(failures.messages).toHaveLength(1)
    expect(failures.messages[0]).toMatch(
      /ERR_DUPLICATE_KEY is declared in .*core\/v1\/spec\.md §7 and again in this family's diagnostics table/,
    )
  })

  test('a kind family that does not list core fails', () => {
    const fx = fixture()
    writeCore(fx)
    writeKind(fx, { name: 'alpha' })
    writeKind(fx, { name: 'beta', dependencies: ['alpha'] })

    const failures = new Failures()
    const context = loadContext(fx.root, failures)
    expect(failures.messages).toHaveLength(1)
    expect(failures.messages[0]).toMatch(/beta\/v1 spec\.md §2 does not list core/)
    expect(registryOf(context, 'beta').has('ERR_DUPLICATE_KEY')).toBe(false)
  })

  test('a kind family whose §2 declares no dependencies at all fails', () => {
    const fx = fixture()
    writeCore(fx)
    writeKind(fx, { name: 'alpha', bindings: false })

    const failures = new Failures()
    loadContext(fx.root, failures)
    expect(failures.messages).toHaveLength(1)
    expect(failures.messages[0]).toMatch(/alpha\/v1 spec\.md §2 declares no normative dependencies/)
  })
})

/** Write one core case, `case.yaml` plus metadata and any diagnostics. */
function writeCoreCase(
  fx: FixtureRepo,
  path: string,
  metadata: CaseMetadata,
  document: string,
  diagnostics?: readonly { code: string; path: string }[],
): void {
  const dir = `${familyPaths(CORE_FAMILY, 'v1').conformance}/${path}`
  fx.writeFile(`${dir}/metadata.json`, canonicalJson(metadata as never))
  fx.writeFile(`${dir}/case.yaml`, document)
  if (diagnostics !== undefined)
    fx.writeFile(`${dir}/diagnostics.json`, canonicalJson(diagnostics as never))
}

function writeCoreIndex(fx: FixtureRepo, entries: readonly { id: string; path: string }[]): void {
  fx.writeFile(
    `${familyPaths(CORE_FAMILY, 'v1').conformance}/cases.json`,
    canonicalJson({
      family: 'core',
      specVersion: 'v1',
      cases: entries.map((e) => ({ id: e.id, phase: 'parser', path: e.path })),
    }),
  )
}

const CORE_ONLY_SPEC = [
  '# Musher Document Core Specification',
  '',
  '## <a id="validation-layers"></a>6. Validation layers',
  '',
  '### <a id="yaml-profile"></a>6.1 The Musher YAML profile',
  '',
  '<a id="CORE-YAML-006"></a>A mapping key appears once.',
  '',
  ...diagnosticsTable([['ERR_DUPLICATE_KEY', 'parser']]),
].join('\n')

describe('the core corpus', () => {
  test('runs through the parser alone, with no bundle and no dispatch on kind', () => {
    const fx = fixture()
    writeCore(fx, CORE_ONLY_SPEC)
    writeCoreCase(
      fx,
      'parser/001-reject-duplicate-keys',
      {
        id: 'parser-001-reject-duplicate-keys',
        phase: 'parser',
        expected: 'fail',
        clause: clauseOf('core', 'yaml-profile'),
        requirements: ['CORE-YAML-006'],
      },
      'specVersion: v1\nkind: COMPONENT\nmetadata: {}\nspec: {}\nspec: {}\n',
      [{ code: 'ERR_DUPLICATE_KEY', path: '' }],
    )
    // Its `kind` names no family in the tree. A runner dispatching on it would
    // have nothing to dispatch to; the parser accepts the document regardless.
    writeCoreCase(
      fx,
      'parser/002-accept-any-kind',
      {
        id: 'parser-002-accept-any-kind',
        phase: 'parser',
        expected: 'pass',
        clause: clauseOf('core', 'validation-layers'),
      },
      'specVersion: v1\nkind: NO_SUCH_FAMILY\nmetadata: {}\nspec: {}\n',
    )
    writeCoreIndex(fx, [
      { id: 'parser-001-reject-duplicate-keys', path: 'parser/001-reject-duplicate-keys' },
      { id: 'parser-002-accept-any-kind', path: 'parser/002-accept-any-kind' },
    ])

    const result = runConformance(fx.root, () => {})
    expect(result.failures.messages).toEqual([])
    expect(result.ran).toBe(2)
    expect(result.corpora.get('core/v1')).toBe(2)
    expect(result.pinned).toBe(1)
    expect(existsSync(join(fx.root, familyPaths(CORE_FAMILY, 'v1').bundle))).toBe(false)
  })

  test('a core case the parser accepts, declared to fail, fails', () => {
    const fx = fixture()
    writeCore(fx, CORE_ONLY_SPEC)
    writeCoreCase(
      fx,
      'parser/001-reject-duplicate-keys',
      {
        id: 'parser-001-reject-duplicate-keys',
        phase: 'parser',
        expected: 'fail',
        clause: clauseOf('core', 'yaml-profile'),
        requirements: ['CORE-YAML-006'],
      },
      'specVersion: v1\nkind: COMPONENT\nmetadata: {}\nspec: {}\n',
      [{ code: 'ERR_DUPLICATE_KEY', path: '' }],
    )
    writeCoreIndex(fx, [
      { id: 'parser-001-reject-duplicate-keys', path: 'parser/001-reject-duplicate-keys' },
    ])

    const { failures } = runConformance(fx.root, () => {})
    expect(failures.messages).toContain(
      'core/v1/parser-001-reject-duplicate-keys: expected the parser to reject it, but the parser accepted it',
    )
  })

  test('a core case declaring effective values is malformed', () => {
    const fx = fixture()
    writeCore(fx, CORE_ONLY_SPEC)
    writeCoreCase(
      fx,
      'parser/001-accepts',
      {
        id: 'parser-001-accepts',
        phase: 'parser',
        expected: 'pass',
        clause: clauseOf('core', 'yaml-profile'),
        requirements: ['CORE-YAML-006'],
        effective: { '/metadata': {} },
      },
      'specVersion: v1\nkind: COMPONENT\nmetadata: {}\nspec: {}\n',
    )
    writeCoreIndex(fx, [{ id: 'parser-001-accepts', path: 'parser/001-accepts' }])

    const { failures, ran } = runConformance(fx.root, () => {})
    expect(ran).toBe(0)
    expect(failures.messages.some((m) => /declares no "effective" values/.test(m))).toBe(true)
  })

  test("core's codes count as covered by a case in any corpus", () => {
    const fx = fixture()
    writeCore(fx, CORE_ONLY_SPEC)
    writeCoreIndex(fx, [])

    // With no case anywhere, core's one code is reported uncovered.
    const { failures } = runConformance(fx.root, () => {})
    expect(failures.messages).toContain(
      'core/v1: ERR_DUPLICATE_KEY is declared in ' +
        `${join(fx.root, familyPaths(CORE_FAMILY, 'v1').spec)} but no indexed case in any corpus ` +
        'exercises it. Add a fixture, or record it in UNCOVERED with a reason.',
    )
  })
})

describe('checkClauseConsistency', () => {
  function context(): Context {
    const fx = fixture()
    writeCore(fx)
    writeKind(fx, { name: 'alpha' })
    writeKind(fx, { name: 'beta', dependencies: [CORE_FAMILY, 'alpha'] })
    writeKind(fx, { name: 'gamma' })
    const failures = new Failures()
    const loaded = loadContext(fx.root, failures)
    expect(failures.messages).toEqual([])
    return loaded
  }

  function check(
    loaded: Context,
    name: string,
    metadata: Pick<CaseMetadata, 'phase' | 'clause' | 'requirements'>,
  ): string[] {
    const failures = new Failures()
    const ok = checkClauseConsistency(loaded, family(loaded, name), 'case', metadata, failures)
    expect(ok).toBe(failures.count === 0)
    return [...failures.messages]
  }

  test('accepts a clause citing its own spec for a requirement a dependency declares', () => {
    const loaded = context()
    expect(
      check(loaded, 'beta', {
        phase: 'structural',
        clause: clauseOf('beta', 'metadata'),
        requirements: ['ALPHA-META-001'],
      }),
    ).toEqual([])
  })

  test('accepts a clause citing a section that encloses the requirement', () => {
    const loaded = context()
    expect(
      check(loaded, 'alpha', {
        phase: 'parser',
        clause: clauseOf('core', 'validation-layers'),
        requirements: ['CORE-YAML-006'],
      }),
    ).toEqual([])
  })

  test('(a) rejects a requirement declared outside the family, core and its dependencies', () => {
    const loaded = context()
    const messages = check(loaded, 'gamma', {
      phase: 'structural',
      clause: clauseOf('gamma', 'metadata'),
      requirements: ['ALPHA-META-001'],
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(
      /ALPHA-META-001 is declared in specifications\/alpha\/v1\/spec\.md, which is neither .* nor a normative dependency gamma\/v1 §2 declares/,
    )
  })

  test('(b) rejects a clause citing a spec that declares none of the requirements', () => {
    const loaded = context()
    const messages = check(loaded, 'beta', {
      phase: 'structural',
      clause: clauseOf('alpha', 'metadata'),
      requirements: ['CORE-ENV-002'],
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(
      /clause cites specifications\/alpha\/v1\/spec\.md, which declares none/,
    )
  })

  test('(b) with no requirements, rejects a clause outside what the family may cite', () => {
    const loaded = context()
    const messages = check(loaded, 'alpha', {
      phase: 'structural',
      clause: clauseOf('gamma', 'metadata'),
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(
      /clause cites specifications\/gamma\/v1\/spec\.md, which is neither/,
    )
  })

  test('(c) rejects an anchor that does not enclose the requirement', () => {
    const loaded = context()
    const messages = check(loaded, 'alpha', {
      phase: 'structural',
      clause: clauseOf('core', 'validation-layers'),
      requirements: ['CORE-ENV-002'],
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(
      /clause cites #validation-layers, but CORE-ENV-002 is declared under #envelope/,
    )
  })

  test('(c) rejects a child section of the one declaring the requirement', () => {
    const loaded = context()
    const messages = check(loaded, 'alpha', {
      phase: 'structural',
      clause: clauseOf('core', 'yaml-profile'),
      requirements: ['CORE-YAML-006', 'CORE-ENV-002'],
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/but CORE-ENV-002 is declared under #envelope/)
  })

  test('(d) rejects a core case outside the parser phase', () => {
    const loaded = context()
    const messages = check(loaded, CORE_FAMILY, {
      phase: 'structural',
      clause: clauseOf('core', 'envelope'),
      requirements: ['CORE-ENV-002'],
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/a core case is a parser case, not structural/)
  })

  test('(d) rejects a core case citing a family spec or a family requirement', () => {
    const loaded = context()
    const messages = check(loaded, CORE_FAMILY, {
      phase: 'parser',
      clause: clauseOf('alpha', 'metadata'),
      requirements: ['ALPHA-META-001'],
    })
    expect(messages).toEqual([
      'case: a core case cites core only, but clause cites specifications/alpha/v1/spec.md',
      'case: a core case cites core only, but ALPHA-META-001 is declared in specifications/alpha/v1/spec.md',
    ])
  })
})
