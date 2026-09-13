/**
 * `release:stage`: what it refuses, what the archive holds, and that the
 * archive is the same bytes every time.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBlobAtRef, tagCommit } from '../lib/git.ts'
import { CORE_FAMILY, familyPaths, LEDGER_FILE } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { Pipeline } from '../testing/pipeline.ts'
import { type LedgerEntry, readLedger, serializeLedger } from './ledger.ts'
import { sha256 } from './releases.ts'
import { StageError, stageRelease } from './stage.ts'

const COMPONENT = familyPaths('component', 'v1')
const CORE = familyPaths(CORE_FAMILY, 'v1')

let repo: FixtureRepo | null = null
const scratch: string[] = []

afterEach(() => {
  repo?.cleanup()
  repo = null
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(): { fx: FixtureRepo; p: Pipeline } {
  const fx = new FixtureRepo()
  repo = fx
  return { fx, p: new Pipeline(fx) }
}

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'musher-stage-test-'))
  scratch.push(dir)
  return dir
}

function members(archive: string): string[] {
  const result = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  return result.stdout.trim().split('\n')
}

function member(archive: string, name: string): string {
  return spawnSync('tar', ['-xzOf', archive, name], { encoding: 'utf8' }).stdout
}

function refusal(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof StageError) return error.message
    throw error
  }
  throw new Error('expected stageRelease to refuse')
}

describe('stageRelease', () => {
  test('stages a kind family bundle and archive whose bundle hash is the ledger’s', () => {
    const { fx, p } = fixture()
    p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'), { publish: false })
    const out = outDir()
    const staged = stageRelease(fx.root, 'component/v1.0.0', out)

    expect(staged.map((f) => f.name)).toEqual(['component.schema.json', 'component-v1.0.0.tar.gz'])
    expect(readdirSync(out).sort()).toEqual(['component-v1.0.0.tar.gz', 'component.schema.json'])
    const entry = readLedger(fx.root).releases['component/v1.0.0']
    expect(sha256(readFileSync(join(out, 'component.schema.json')))).toBe(
      entry?.bundleSha256 as string,
    )
    for (const file of staged) expect(sha256(readFileSync(file.path))).toBe(file.sha256)
  })

  test('the archive carries the family, the core it was built against, and release.json', () => {
    const { fx, p } = fixture()
    p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'), { publish: false })
    const out = outDir()
    stageRelease(fx.root, 'component/v1.0.0', out)
    const archive = join(out, 'component-v1.0.0.tar.gz')

    expect(members(archive)).toEqual([
      'component-v1/',
      'component-v1/LICENSE',
      'component-v1/NOTICE',
      'component-v1/component.schema.json',
      'component-v1/conformance/',
      'component-v1/conformance/README.md',
      'component-v1/conformance/cases.json',
      'component-v1/core/',
      'component-v1/core/conformance/',
      'component-v1/core/conformance/cases.json',
      'component-v1/core/spec.md',
      'component-v1/examples/',
      'component-v1/examples/minimal.yaml',
      'component-v1/release.json',
      'component-v1/spec.md',
    ])
    const manifest = JSON.parse(member(archive, 'component-v1/release.json'))
    expect(manifest).toEqual({
      bundleSha256: readLedger(fx.root).releases['component/v1.0.0']?.bundleSha256,
      commit: tagCommit(fx.root, 'component/v1.0.0'),
      coreCommit: tagCommit(fx.root, 'core/v1.0.0'),
      coreTag: 'core/v1.0.0',
      requires: { core: '1.0.0' },
      tag: 'component/v1.0.0',
    })
  })

  test('the archive is byte-identical across runs', () => {
    const { fx, p } = fixture()
    p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'), { publish: false })
    const [a, b] = [outDir(), outDir()]
    stageRelease(fx.root, 'component/v1.0.0', a)
    stageRelease(fx.root, 'component/v1.0.0', b)
    const left = readFileSync(join(a, 'component-v1.0.0.tar.gz'))
    const right = readFileSync(join(b, 'component-v1.0.0.tar.gz'))
    expect(left.equals(right)).toBe(true)
  })

  test('core files come from the recorded core tag, not from the family tag', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0', '## <a id="scope"></a>1. Core as released\n')
    fx.writeFile(CORE.spec, '## <a id="scope"></a>1. Core, tidied after the release\n')
    fx.commit('chore(core): tidy')
    p.releaseKind('component', 'v1', '1.0.0', fx.bundleDoc('component', 'v1'), { publish: false })

    const out = outDir()
    stageRelease(fx.root, 'component/v1.0.0', out)
    const archived = member(join(out, 'component-v1.0.0.tar.gz'), 'component-v1/core/spec.md')
    expect(archived).toBe(
      readBlobAtRef(fx.root, 'core/v1.0.0', CORE.spec)?.toString('utf8') as string,
    )
    expect(archived).not.toContain('tidied')
  })

  test('core stages only its archive', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    const out = outDir()
    const staged = stageRelease(fx.root, 'core/v1.0.0', out)
    expect(staged.map((f) => f.name)).toEqual(['core-v1.0.0.tar.gz'])
    const archive = join(out, 'core-v1.0.0.tar.gz')
    expect(members(archive)).toEqual([
      'core-v1/',
      'core-v1/LICENSE',
      'core-v1/NOTICE',
      'core-v1/conformance/',
      'core-v1/conformance/README.md',
      'core-v1/conformance/cases.json',
      'core-v1/release.json',
      'core-v1/spec.md',
    ])
    expect(JSON.parse(member(archive, 'core-v1/release.json'))).toEqual({
      commit: tagCommit(fx.root, 'core/v1.0.0'),
      tag: 'core/v1.0.0',
    })
  })

  test('refuses a bundle that does not hash to the recorded bundleSha256', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    fx.writeFamilySkeleton('component', 'v1')
    fx.writeFile(COMPONENT.spec, fx.kindSpec('component'))
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1'))
    fx.setManifestVersion(COMPONENT.manifestKey, '1.0.0')
    fx.commit('feat(component): component 1.0.0')
    fx.writeFile(
      LEDGER_FILE,
      serializeLedger({
        version: 2,
        releases: {
          ...readLedger(fx.root).releases,
          'component/v1.0.0': {
            path: COMPONENT.dir,
            tree: fx.treeId('HEAD', COMPONENT.dir),
            bundleSha256: 'e'.repeat(64),
            requires: { core: '1.0.0' },
          },
        },
      }),
    )
    fx.commit('chore(repo): release component 1.0.0 with a wrong hash')
    fx.tag('component/v1.0.0')
    const out = outDir()
    expect(refusal(() => stageRelease(fx.root, 'component/v1.0.0', out))).toContain(
      'the pinned bundle built at the tag hashes to',
    )
    expect(readdirSync(out)).toEqual([])
  })

  test('refuses when the working ledger disagrees with the tag’s', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    const ledger = readLedger(fx.root)
    fx.writeFile(
      LEDGER_FILE,
      serializeLedger({
        version: 2,
        releases: {
          'core/v1.0.0': {
            ...(ledger.releases['core/v1.0.0'] as LedgerEntry),
            path: `${CORE.dir}x`,
          },
        },
      }),
    )
    expect(refusal(() => stageRelease(fx.root, 'core/v1.0.0', outDir()))).toContain('differs')
  })

  test('refuses a core release that carries schemas/src', () => {
    const { fx } = fixture()
    fx.writeCoreSkeleton('v1')
    fx.writeFile(`${CORE.src}/core.schema.json`, '{}\n')
    fx.setManifestVersion(CORE.manifestKey, '1.0.0')
    fx.commit('feat(core): a schema core must not ship')
    fx.setLedger({
      version: 2,
      releases: {
        'core/v1.0.0': { path: CORE.dir, tree: fx.treeId('HEAD', CORE.dir), bundleSha256: null },
      },
    })
    fx.commit('chore(repo): release core 1.0.0')
    fx.tag('core/v1.0.0')
    expect(refusal(() => stageRelease(fx.root, 'core/v1.0.0', outDir()))).toContain(
      'core publishes no schema',
    )
  })

  test('refuses a tag that does not exist', () => {
    const { fx, p } = fixture()
    p.releaseCore('1.0.0')
    expect(refusal(() => stageRelease(fx.root, 'component/v1.0.0', outDir()))).toContain(
      'does not exist',
    )
  })
})
