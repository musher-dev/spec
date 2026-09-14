/**
 * Core has no bundle to diff, so its review report is prose only — and says
 * that it reaches every family. A kind family's report tells a rule that moved
 * into core from one that was removed, and a tooling change from a source one.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { CORE_FAMILY, discoverFamilies, type Family, familyPaths } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { reportFamily, unifiedDiff } from './changes.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

const CORE = familyPaths(CORE_FAMILY, 'v1')

describe('reportFamily for core', () => {
  test('reports requirement and diagnostic changes under an "affects every family" heading', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.writeCoreSkeleton(
      'v1',
      '## <a id="envelope"></a>2. Envelope\n\n<a id="CORE-ENV-001"></a>x\n',
    )
    fx.commit('feat(core): the base family')
    fx.writeFile(
      CORE.spec,
      [
        '## <a id="envelope"></a>2. Envelope',
        '',
        '<a id="CORE-ENV-002"></a>y',
        '',
        '| Code | Phase | Meaning |',
        '|---|---|---|',
        '| `ERR_PARSE` | `parser` | not YAML |',
        '',
      ].join('\n'),
    )

    const [core] = discoverFamilies(fx.root)
    if (core === undefined) throw new Error('fixture has no core family')
    const { lines, narrowing } = reportFamily(core, 'HEAD', fx.root)
    const text = lines.join('\n')

    expect(lines[0]).toBe('### core/v1 — affects every family')
    expect(text).toContain('`ERR_PARSE` — diagnostic added')
    expect(text).toContain('`CORE-ENV-002` — requirement added')
    expect(text).toContain('`CORE-ENV-001` — requirement **removed**')
    expect(text).not.toContain('Fields and constraints')
    expect(narrowing).toBe(1)
  })

  test('says nothing when the prose names nothing new', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.writeCoreSkeleton('v1')
    fx.commit('feat(core): the base family')
    const [core] = discoverFamilies(fx.root)
    if (core === undefined) throw new Error('fixture has no core family')
    expect(reportFamily(core, 'HEAD', fx.root).lines).toEqual([])
  })
})

const COMPONENT = familyPaths('component', 'v1')

/** A component spec §2 that binds core and declares its dependency on it. */
const BINDINGS = [
  '## <a id="envelope"></a>2. Document envelope',
  '',
  '| Core parameter | This family |',
  '|---|---|',
  '| `kind` | `COMPONENT` |',
  '| `metadata` | [§3](#metadata) |',
  '| Fields accepting `null` | none |',
  '| Item document | `component.yaml` |',
  '',
  '| Specification | Line |',
  '|---|---|',
  '| [core](../../core/v1/spec.md) | v1 |',
  '',
].join('\n')

const TABLE = ['| Code | Phase | Meaning |', '|---|---|---|']
const YAML_RULE = 'Duplicate mapping keys MUST be rejected at any depth of the document.'

function component(fx: FixtureRepo): Family {
  const found = discoverFamilies(fx.root).find((f) => f.name === 'component')
  if (found === undefined) throw new Error('fixture has no component family')
  return found
}

describe('reportFamily for a kind family', () => {
  function base(): FixtureRepo {
    const fx = new FixtureRepo()
    repo = fx
    fx.writeCoreSkeleton('v1', '## <a id="scope"></a>1. Scope\n')
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.writeFile(
      COMPONENT.spec,
      [
        '## <a id="yaml"></a>7. YAML',
        '',
        `| <a id="COMP-YAML-006"></a>\`COMP-YAML-006\` | ${YAML_RULE} |`,
        '<a id="COMP-ENV-002"></a>kind is COMPONENT.',
        '<a id="COMP-GONE-001"></a>A rule that is simply dropped from the specification.',
        '',
        ...TABLE,
        '| `ERR_DUPLICATE_KEY` | `parser` | a key twice |',
        '| `ERR_DROPPED` | `semantic` | gone for good |',
        '',
      ].join('\n'),
    )
    fx.writeFile(
      `${COMPONENT.conformance}/structural/002-wrong-kind/metadata.json`,
      '{ "requirements": ["COMP-ENV-002"] }\n',
    )
    fx.commit('feat(component): rules that will move')
    return fx
  }

  test('a code or ID that moved into core is a move, not a removal, and rejects nothing', () => {
    const fx = base()
    const core = familyPaths(CORE_FAMILY, 'v1')
    fx.writeFile(
      core.spec,
      [
        '## <a id="envelope"></a>2. Envelope',
        '',
        '<a id="CORE-ENV-002"></a>kind is the constant the family binds.',
        `| <a id="CORE-YAML-006"></a>\`CORE-YAML-006\` | ${YAML_RULE} |`,
        '',
        ...TABLE,
        '| `ERR_DUPLICATE_KEY` | `parser` | a key twice |',
        '',
      ].join('\n'),
    )
    fx.writeFile(COMPONENT.spec, `${BINDINGS}\n`)
    fx.writeFile(
      `${COMPONENT.conformance}/structural/002-wrong-kind/metadata.json`,
      '{ "requirements": ["CORE-ENV-002"] }\n',
    )
    fx.commit('feat(core): take the shared rules')

    const { lines, narrowing, moved } = reportFamily(component(fx), 'HEAD~1', fx.root)
    const text = lines.join('\n')
    expect(text).toContain('`ERR_DUPLICATE_KEY` — diagnostic moved to core/v1')
    expect(text).toContain(
      '`COMP-YAML-006` — requirement moved to core/v1 as `CORE-YAML-006` (same statement)',
    )
    expect(text).toContain(
      '`COMP-ENV-002` — requirement moved to core/v1 as `CORE-ENV-002` (its cases now cite it)',
    )
    // What left for nowhere is still a removal.
    expect(text).toContain('`ERR_DROPPED` — diagnostic **removed**')
    expect(text).toContain('`COMP-GONE-001` — requirement **removed**')
    expect(moved).toBe(3)
    expect(narrowing).toBe(2)
  })

  test('without a declared dependency, the same move is a removal', () => {
    const fx = base()
    fx.writeFile(
      familyPaths(CORE_FAMILY, 'v1').spec,
      [...TABLE, '| `ERR_DUPLICATE_KEY` | `parser` | a key twice |', ''].join('\n'),
    )
    fx.writeFile(COMPONENT.spec, '## <a id="scope"></a>1. Scope\n')
    fx.commit('feat(component): drop the rules, bind nothing')

    const { lines, moved } = reportFamily(component(fx), 'HEAD~1', fx.root)
    expect(lines.join('\n')).toContain('`ERR_DUPLICATE_KEY` — diagnostic **removed**')
    expect(moved).toBe(0)
  })

  test('bundle bytes that change with no source change are reported as tooling-only', () => {
    const fx = base()
    const same = reportFamily(component(fx), 'HEAD', fx.root)
    expect(same.lines).toEqual([])
    expect(same.before).toBe(same.after)

    const report = reportFamily(component(fx), 'HEAD', fx.root, {
      baseBundle: () => `${JSON.stringify(fx.bundleDoc('component', 'v1'))}\n`,
    })
    expect(report.lines.join('\n')).toContain('**Tooling-only change.**')
    expect(report.narrowing).toBe(0)
    expect(unifiedDiff('component.schema.json', report.before ?? '', report.after ?? '')).toContain(
      '+++ b/head/component.schema.json',
    )
  })

  test('a source change is not called a tooling change', () => {
    const fx = base()
    fx.writeSources(
      'component',
      'v1',
      fx.bundleDoc('component', 'v1', { properties: { name: { type: 'string' } } }),
    )
    const report = reportFamily(component(fx), 'HEAD', fx.root)
    const text = report.lines.join('\n')
    expect(text).not.toContain('Tooling-only')
    expect(text).toContain('Fields and constraints')
  })
})
