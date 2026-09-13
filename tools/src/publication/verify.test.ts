/**
 * `check:published`, offline: the three states in `verifyPublications`, the
 * ledger's field rules, and both forms of the core gate.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../lib/git.ts'
import { CORE_FAMILY, Failures, familyPaths, LEDGER_FILE } from '../lib/layout.ts'
import { pinnedBundle } from '../schema/bundle.ts'
import { gitReader } from '../schema/sources.ts'
import { FixtureRepo, RELEASE_SECTIONS } from '../testing/fixture.ts'
import { Pipeline } from '../testing/pipeline.ts'
import { type LedgerEntry, readLedger, serializeLedger } from './ledger.ts'
import { record } from './record.ts'
import { sha256 } from './releases.ts'
import { verifyPublications } from './verify.ts'

const COMPONENT = familyPaths('component', 'v1')
const CORE = familyPaths(CORE_FAMILY, 'v1')

let repo: FixtureRepo | null = null
let scratch: string | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true })
  scratch = null
})

function fixture(): { fx: FixtureRepo; p: Pipeline } {
  const fx = new FixtureRepo()
  repo = fx
  return { fx, p: new Pipeline(fx) }
}

function verify(root: string): { failures: string[]; warnings: string[] } {
  const failures = new Failures()
  const warnings: string[] = []
  verifyPublications(root, failures, warnings)
  return { failures: [...failures.messages], warnings }
}

/** Commit component sources at `version`, ready to record. */
function prepare(fx: FixtureRepo, version: string, extra: object = {}): void {
  fx.writeFamilySkeleton('component', 'v1')
  if (!fx.hasBindings(COMPONENT.spec)) fx.writeFile(COMPONENT.spec, fx.kindSpec('component'))
  fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', extra as never))
  fx.setManifestVersion(COMPONENT.manifestKey, version)
  fx.commit(`feat(component): component ${version}`)
}

/**
 * Record a component release by hand, bypassing the core gate, then tag it —
 * the forgery a rewritten ledger or a tag cut outside the flow would produce.
 */
function forge(fx: FixtureRepo, version: string, requiresCore = '1.0.0'): void {
  const bundle = pinnedBundle({ name: 'component', major: 'v1', repoRoot: fx.root }, version, {
    reader: gitReader(fx.root, 'HEAD'),
  })
  const ledger = readLedger(fx.root)
  fx.writeFile(
    LEDGER_FILE,
    serializeLedger({
      version: 2,
      releases: {
        ...ledger.releases,
        [`component/v${version}`]: {
          path: COMPONENT.dir,
          tree: fx.treeId('HEAD', COMPONENT.dir),
          bundleSha256: sha256(bundle as string),
          requires: { core: requiresCore },
        },
      },
    }),
  )
  fx.commit(`chore(repo): release component ${version}`)
  fx.tag(`component/v${version}`)
}

describe('verifyPublications', () => {
  test('an empty repository verifies as clean', () => {
    const fx = new FixtureRepo()
    repo = fx
    expect(verify(fx.root)).toEqual({ failures: [], warnings: [] })
  })

  test('released core and component pass', () => {
    const { fx, p } = fixture()
    p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    expect(verify(fx.root)).toEqual({ failures: [], warnings: [] })
  })

  test('a tag with no ledger entry fails', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    fx.tag('component/v9.9.9')
    expect(verify(fx.root).failures).toEqual([
      expect.stringContaining('component/v9.9.9 is tagged but absent from published.json'),
    ])
  })

  test('a tagged entry whose tree does not match fails', () => {
    const { fx, p } = fixture()
    p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    const ledger = readLedger(fx.root)
    const entry = ledger.releases['component/v1.0.0']
    fx.writeFile(
      LEDGER_FILE,
      serializeLedger({
        version: 2,
        releases: {
          ...ledger.releases,
          'component/v1.0.0': { ...(entry as LedgerEntry), tree: '0'.repeat(40) },
        },
      }),
    )
    expect(verify(fx.root).failures).toEqual([
      expect.stringContaining('A released version has been altered'),
    ])
  })

  test('a tagged entry absent from the tag’s own ledger fails', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    prepare(fx, '1.0.0')
    record(fx.root)
    const recorded = readFileSync(join(fx.root, LEDGER_FILE), 'utf8')
    // Tag first, record after: the order ADR 0006 §4 exists to rule out.
    git(fx.root, ['checkout', '--', LEDGER_FILE])
    fx.tag('component/v1.0.0')
    fx.writeFile(LEDGER_FILE, recorded)
    fx.commit('chore(repo): record after the tag')
    expect(verify(fx.root).failures).toEqual([
      expect.stringContaining("the tag's own published.json does not record it"),
    ])
  })

  test('a pending entry passes, and goes stale when the branch moves without re-recording', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    prepare(fx, '1.0.0')
    record(fx.root)
    fx.commit('chore(repo): release component 1.0.0')
    expect(verify(fx.root)).toEqual({ failures: [], warnings: [] })

    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'moved' }))
    fx.commit('feat(component): moved after recording')
    const { failures } = verify(fx.root)
    expect(failures).toEqual([
      expect.stringContaining('at HEAD, but published.json records'),
      expect.stringContaining('records bundleSha256'),
    ])
  })

  test('a pending entry whose manifest disagrees fails', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    prepare(fx, '1.0.0')
    record(fx.root)
    fx.setManifestVersion(COMPONENT.manifestKey, '1.2.0')
    fx.commit('chore: the manifest moved out from under the entry')
    expect(verify(fx.root).failures).toEqual([
      expect.stringContaining('only valid while its release is pending'),
      expect.stringContaining('reads 1.2.0, which is neither tagged nor recorded'),
    ])
  })

  test('an uncommitted change under a pending release warns', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    prepare(fx, '1.0.0')
    record(fx.root)
    fx.commit('chore(repo): release component 1.0.0')
    fx.writeFile(`${COMPONENT.examples}/draft.yaml`, 'kind: COMPONENT\n')
    expect(verify(fx.root)).toEqual({
      failures: [],
      warnings: [expect.stringContaining('has uncommitted changes')],
    })
  })

  test('a pending entry fails the core gate after a releasable core commit', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    prepare(fx, '1.0.0')
    record(fx.root)
    fx.commit('chore(repo): release component 1.0.0')
    fx.writeFile(CORE.spec, '## <a id="scope"></a>1. Core scope, amended\n')
    fx.commit('fix(core): amend a rule')
    expect(verify(fx.root).failures).toEqual([
      expect.stringContaining('releasable commit(s) since core/v1.0.0'),
    ])
  })

  test('a core entry with a hash, or a kind entry without one, fails', () => {
    const { fx, p } = fixture()
    p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    const text = readFileSync(join(fx.root, LEDGER_FILE), 'utf8')
    const doc = JSON.parse(text)
    doc.releases['core/v1.0.0'].bundleSha256 = 'f'.repeat(64)
    doc.releases['component/v1.0.0'].bundleSha256 = null
    fx.writeFile(LEDGER_FILE, JSON.stringify(doc))
    expect(verify(fx.root).failures).toEqual([
      expect.stringContaining('a kind family\'s "bundleSha256" must be a sha256 hex digest'),
      expect.stringContaining('core publishes no schema, so "bundleSha256" must be null'),
    ])
  })

  describe('the tagged core gate', () => {
    test('fails when the required core tag is not an ancestor of the release', () => {
      const { fx, p } = fixture()
      p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
      fx.commit('chore: a later commit')
      // Moved, not rewritten: the core tree and ledger entry still match.
      fx.forceTag('core/v1.0.0', 'HEAD')
      expect(verify(fx.root).failures).toEqual([
        expect.stringContaining('core/v1.0.0 is not an ancestor of it'),
      ])
    })

    test('does not reclassify history: a releasable core commit before the release is stage’s to refuse', () => {
      const { fx, p } = fixture()
      p.releaseCore('1.0.0')
      fx.writeFile(CORE.spec, '## <a id="scope"></a>1. Core scope, extended\n')
      fx.commit('feat(core): a rule core never released')
      prepare(fx, '1.0.0')
      forge(fx, '1.0.0')
      expect(verify(fx.root).failures).toEqual([])
    })

    test('a later config change that unhides a type does not fail an existing tagged release', () => {
      const { fx, p } = fixture()
      p.releaseCore('1.0.0')
      fx.writeFile(CORE.spec, '## <a id="scope"></a>1. Core scope, tidied\n')
      fx.commit('chore(core): tidy')
      p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
      expect(verify(fx.root)).toEqual({ failures: [], warnings: [] })

      fx.writeReleaseConfig(
        RELEASE_SECTIONS.map((s) => (s.type === 'chore' ? { type: 'chore' } : s)),
      )
      fx.commit('ci(repo): show maintenance in the changelog')
      expect(verify(fx.root)).toEqual({ failures: [], warnings: [] })
    })
  })

  describe('a manifest version neither tagged nor recorded', () => {
    test('fails on the release branch, and still fails once tagged without an entry', () => {
      const { fx, p } = fixture()
      p.releaseCore('1.0.0')
      // The release pull request before release-ledger.yml has pushed its entry.
      prepare(fx, '1.0.0')
      expect(verify(fx.root).failures).toEqual([
        expect.stringContaining(
          `${COMPONENT.manifestKey} reads 1.0.0, which is neither tagged nor recorded`,
        ),
      ])

      // Merged and tagged anyway: now it is a tag with no entry.
      fx.tag('component/v1.0.0')
      expect(verify(fx.root).failures).toEqual([
        expect.stringContaining('component/v1.0.0 is tagged but absent from published.json'),
      ])
    })

    test('0.0.0 is never released, so it is never unrecorded', () => {
      const { fx, p } = fixture()
      p.releaseCore('1.0.0')
      fx.setManifestVersion(COMPONENT.manifestKey, '0.0.0')
      fx.commit('chore(repo): an unreleased package')
      expect(verify(fx.root).failures).toEqual([])
    })
  })

  test('a shallow clone with recorded releases and no tags fails', () => {
    const { fx, p } = fixture()
    p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'))
    scratch = mkdtempSync(join(tmpdir(), 'musher-shallow-'))
    const clone = join(scratch, 'clone')
    git(scratch, ['clone', '-q', '--depth', '1', '--no-tags', `file://${fx.root}`, clone])
    expect(verify(clone).failures).toEqual([expect.stringContaining('shallow clone with no tags')])
  })
})
