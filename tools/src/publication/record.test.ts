/**
 * `record` writes what `check:published` re-derives, updates a pending entry
 * rather than leaving it stale, never touches a tagged one, and refuses a kind
 * family release the core gate does not allow.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_FAMILY, familyPaths, LEDGER_FILE } from '../lib/layout.ts'
import { pinnedBundle } from '../schema/bundle.ts'
import { gitReader } from '../schema/sources.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { Pipeline } from '../testing/pipeline.ts'
import { readLedger } from './ledger.ts'
import { RecordError, record } from './record.ts'
import { sha256 } from './releases.ts'

const COMPONENT = familyPaths('component', 'v1')
const CORE = familyPaths(CORE_FAMILY, 'v1')

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

/** A repository where core 1.0.0 is released and component is ready to record. */
function ready(options: { core?: boolean } = {}): { fx: FixtureRepo; p: Pipeline } {
  const fx = new FixtureRepo()
  repo = fx
  const p = new Pipeline(fx)
  if (options.core !== false) p.releaseCore('1.0.0')
  fx.writeFamilySkeleton('component', 'v1')
  fx.writeFile(COMPONENT.spec, fx.kindSpec('component'))
  fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
  fx.setManifestVersion(COMPONENT.manifestKey, '1.0.0')
  fx.commit('feat(component): component 1.0.0')
  return { fx, p }
}

function ledgerText(fx: FixtureRepo): string {
  return readFileSync(join(fx.root, LEDGER_FILE), 'utf8')
}

function refusal(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof RecordError) return error.message
    throw error
  }
  throw new Error('expected record to refuse')
}

describe('record', () => {
  test('records the tree, the pinned bundle hash, and core’s manifest version', () => {
    const { fx } = ready()
    const result = record(fx.root)
    expect(result.recorded).toEqual(['component/v1.0.0'])

    const entry = readLedger(fx.root).releases['component/v1.0.0']
    const bundle = pinnedBundle({ name: 'component', major: 'v1', repoRoot: fx.root }, '1.0.0', {
      reader: gitReader(fx.root, 'HEAD'),
    })
    expect(entry).toEqual({
      path: COMPONENT.dir,
      tree: fx.treeId('HEAD', COMPONENT.dir),
      bundleSha256: sha256(bundle as string),
      requires: { core: '1.0.0' },
    })
  })

  test('records core with a null hash and no requires', () => {
    const fx = new FixtureRepo()
    repo = fx
    new Pipeline(fx)
    fx.writeCoreSkeleton('v1')
    fx.setManifestVersion(CORE.manifestKey, '1.0.0')
    fx.commit('feat(core): core 1.0.0')
    record(fx.root)
    expect(readLedger(fx.root).releases['core/v1.0.0']).toEqual({
      path: CORE.dir,
      tree: fx.treeId('HEAD', CORE.dir),
      bundleSha256: null,
    })
  })

  test('is idempotent', () => {
    const { fx } = ready()
    record(fx.root)
    const before = ledgerText(fx)
    const second = record(fx.root)
    expect(second).toMatchObject({ recorded: [], updated: [], changed: false })
    expect(ledgerText(fx)).toBe(before)
  })

  test('updates a pending entry after the branch changes', () => {
    const { fx } = ready()
    record(fx.root)
    fx.commit('chore(repo): release component 1.0.0')
    const stale = readLedger(fx.root).releases['component/v1.0.0']

    // "Update branch" brings a change from main into the release branch.
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'merged' }))
    fx.commit('feat(component): a change from main')
    const result = record(fx.root)

    expect(result.updated).toEqual(['component/v1.0.0'])
    const fresh = readLedger(fx.root).releases['component/v1.0.0']
    expect(fresh?.tree).not.toBe(stale?.tree)
    expect(fresh?.bundleSha256).not.toBe(stale?.bundleSha256)
  })

  test('drops a pending entry whose manifest moved to another version', () => {
    const { fx } = ready()
    record(fx.root)
    fx.setManifestVersion(COMPONENT.manifestKey, '1.1.0')
    fx.commit('chore(repo): release component 1.1.0')
    const result = record(fx.root)
    expect(result.dropped).toEqual(['component/v1.0.0'])
    expect(Object.keys(readLedger(fx.root).releases).sort()).toEqual([
      'component/v1.1.0',
      'core/v1.0.0',
    ])
  })

  test('never rewrites an entry whose tag exists', () => {
    const { fx, p } = ready()
    p.recordAndTag('component/v1.0.0')
    const before = ledgerText(fx)
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'later' }))
    fx.commit('feat(component): after the release')
    expect(record(fx.root).changed).toBe(false)
    expect(ledgerText(fx)).toBe(before)
  })

  test('refuses uncommitted changes in the family version', () => {
    const { fx } = ready()
    fx.writeFile(`${COMPONENT.examples}/extra.yaml`, 'kind: COMPONENT\n')
    expect(refusal(() => record(fx.root))).toContain('uncommitted changes')
  })

  describe('the core gate', () => {
    test('refuses while core’s manifest reads 0.0.0, and writes nothing', () => {
      const { fx } = ready({ core: false })
      fx.setManifestVersion(CORE.manifestKey, '0.0.0')
      fx.commit('chore: core unreleased')
      expect(refusal(() => record(fx.root))).toContain('has never been released')
      expect(readLedger(fx.root).releases).toEqual({})
    })

    test('refuses when the core tag it would require does not exist', () => {
      const { fx } = ready({ core: false })
      fx.writeCoreSkeleton('v1')
      fx.setManifestVersion(CORE.manifestKey, '1.0.0')
      fx.commit('chore: core manifest ahead of its tag')
      expect(refusal(() => record(fx.root))).toContain('core/v1.0.0 does not exist')
    })

    const releasable: [string, string?][] = [
      ['feat(core): a new rule'],
      ['fix(core): a corrected rule'],
      ['docs(core): clarified prose'],
      ['refactor(core)!: a breaking reshape'],
      ['chore(core): tidy', 'BREAKING CHANGE: a rule moved'],
    ]
    for (const [subject, body] of releasable) {
      test(`refuses after ${JSON.stringify(subject)}${body === undefined ? '' : ' with a breaking footer'}`, () => {
        const { fx } = ready()
        fx.writeFile(CORE.spec, `## <a id="scope"></a>1. Core scope — ${subject}\n`)
        fx.commit(subject, body)
        const message = refusal(() => record(fx.root))
        expect(message).toContain('releasable commit(s) since core/v1.0.0')
        expect(message).toContain(subject)
      })
    }

    for (const subject of ['chore(core): tidy', 'test(core): another fixture']) {
      test(`only warns after ${JSON.stringify(subject)}`, () => {
        const { fx } = ready()
        fx.writeFile(`${CORE.conformance}/extra.json`, '{}\n')
        fx.commit(subject)
        const result = record(fx.root)
        expect(result.recorded).toEqual(['component/v1.0.0'])
        expect(result.warnings).toEqual([expect.stringContaining('non-releasable commit(s)')])
      })
    }

    test('refuses a family whose §2 cites no core line', () => {
      const { fx } = ready()
      fx.writeFile(COMPONENT.spec, '## <a id="scope"></a>1. Scope\n')
      fx.commit('docs(component): lose the bindings')
      expect(refusal(() => record(fx.root))).toContain('cites no core line')
    })
  })
})
