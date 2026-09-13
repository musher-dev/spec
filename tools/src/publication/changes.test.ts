/**
 * Core has no bundle to diff, so its review report is prose only — and says
 * that it reaches every family.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { CORE_FAMILY, discoverFamilies, familyPaths } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { reportFamily } from './changes.ts'

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
