/**
 * The ledger's shape (docs/adr/0023 §3) and its one invariant: nothing already
 * recorded may ever change.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { CORE_FAMILY, Failures, familyPaths, type Json, LEDGER_FILE } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import {
  type AnyLedger,
  assertAppendOnly,
  EMPTY_LEDGER,
  type Ledger,
  ledgerAtRef,
  parseLedger,
  readLedger,
  serializeLedger,
  validateLedger,
} from './ledger.ts'

const COMPONENT = familyPaths('component', 'v1')
const CORE = familyPaths(CORE_FAMILY, 'v1')
const TREE = 'a'.repeat(40)
const SHA = 'b'.repeat(64)

const kindEntry = {
  path: COMPONENT.dir,
  tree: TREE,
  bundleSha256: SHA,
  requires: { core: '1.0.0' },
}
const coreEntry = { path: CORE.dir, tree: TREE, bundleSha256: null }

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

function problems(doc: Json): string[] {
  const failures = new Failures()
  validateLedger(doc, failures)
  return [...failures.messages]
}

function appendOnly(base: AnyLedger, head: Ledger): string[] {
  const failures = new Failures()
  assertAppendOnly(base, head, failures)
  return [...failures.messages]
}

describe('validateLedger', () => {
  test('accepts a kind family entry and a core entry', () => {
    expect(
      problems({
        version: 2,
        releases: { 'component/v1.0.0': kindEntry, 'core/v1.0.0': coreEntry },
      }),
    ).toEqual([])
  })

  test('bundleSha256 is null if and only if the family is core', () => {
    expect(
      problems({ version: 2, releases: { 'core/v1.0.0': { ...coreEntry, bundleSha256: SHA } } }),
    ).toEqual([expect.stringContaining('"bundleSha256" must be null')])
    expect(
      problems({
        version: 2,
        releases: { 'component/v1.0.0': { ...kindEntry, bundleSha256: null } },
      }),
    ).toEqual([expect.stringContaining('must be a sha256 hex digest')])
  })

  test('requires is present if and only if the family is not core', () => {
    expect(
      problems({
        version: 2,
        releases: { 'core/v1.0.0': { ...coreEntry, requires: { core: '1.0.0' } } },
      }),
    ).toEqual([expect.stringContaining('"requires" must be absent')])

    const { requires: _, ...withoutRequires } = kindEntry
    expect(problems({ version: 2, releases: { 'component/v1.0.0': withoutRequires } })).toEqual([
      expect.stringContaining('must record "requires"'),
    ])
    expect(
      problems({
        version: 2,
        releases: { 'component/v1.0.0': { ...kindEntry, requires: { core: '1.0' } } },
      }),
    ).toEqual([expect.stringContaining('exact X.Y.Z')])
    expect(
      problems({
        version: 2,
        releases: {
          'component/v1.0.0': { ...kindEntry, requires: { core: '1.0.0', listing: '1.0.0' } },
        },
      }),
    ).toEqual([expect.stringContaining('unknown family "listing"')])
  })

  test('rejects a non-tag key, an unknown field, a bad tree, and a path that escapes', () => {
    expect(problems({ version: 2, releases: { 'component-1.0.0': kindEntry } })[0]).toContain(
      'not a release tag',
    )
    expect(
      problems({ version: 2, releases: { 'component/v1.0.0': { ...kindEntry, sha: SHA } } }),
    ).toEqual([expect.stringContaining('unknown field "sha"')])
    expect(
      problems({ version: 2, releases: { 'component/v1.0.0': { ...kindEntry, tree: 'HEAD' } } }),
    ).toEqual([expect.stringContaining('git tree id')])
    for (const path of ['../component', '/specifications/component/v1', 'a/./b', '']) {
      expect(
        problems({ version: 2, releases: { 'component/v1.0.0': { ...kindEntry, path } } }),
      ).toEqual([expect.stringContaining('repo-relative directory')])
    }
  })

  test('a version 1 ledger is not a head ledger', () => {
    expect(problems({ version: 1, releases: {} })).toEqual([
      expect.stringContaining('"version" must be 2'),
    ])
  })
})

describe('serializeLedger', () => {
  test('is canonical: sorted tags and fields, and no requires on core', () => {
    const ledger: Ledger = {
      version: 2,
      releases: { 'core/v1.0.0': coreEntry, 'component/v1.0.0': kindEntry },
    }
    const text = serializeLedger(ledger)
    expect(text).toBe(
      `${JSON.stringify(
        {
          releases: {
            'component/v1.0.0': {
              bundleSha256: SHA,
              path: COMPONENT.dir,
              requires: { core: '1.0.0' },
              tree: TREE,
            },
            'core/v1.0.0': { bundleSha256: null, path: CORE.dir, tree: TREE },
          },
          version: 2,
        },
        null,
        2,
      )}\n`,
    )
    expect(parseLedger(text)).toEqual(ledger)
    expect(serializeLedger(EMPTY_LEDGER)).toBe('{\n  "releases": {},\n  "version": 2\n}\n')
  })
})

describe('assertAppendOnly', () => {
  const base: Ledger = { version: 2, releases: { 'component/v1.0.0': kindEntry } }

  test('accepts an addition', () => {
    expect(
      appendOnly(base, { version: 2, releases: { ...base.releases, 'core/v1.0.0': coreEntry } }),
    ).toEqual([])
  })

  test('rejects a removal', () => {
    expect(appendOnly(base, EMPTY_LEDGER)[0]).toContain('cannot be unpublished')
  })

  test('rejects a change to any recorded field, requires included', () => {
    for (const changed of [
      { ...kindEntry, tree: 'c'.repeat(40) },
      { ...kindEntry, bundleSha256: 'c'.repeat(64) },
      { ...kindEntry, path: familyPaths('component', 'v2').dir },
      { ...kindEntry, requires: { core: '1.0.1' } },
    ]) {
      expect(
        appendOnly(base, { version: 2, releases: { 'component/v1.0.0': changed } })[0],
      ).toContain('is immutable')
    }
  })

  test('accepts rewriting an empty version 1 ledger as version 2', () => {
    expect(appendOnly({ version: 1, releases: {} }, base)).toEqual([])
  })

  test('refuses rewriting a version 1 ledger that recorded anything', () => {
    const v1: AnyLedger = {
      version: 1,
      releases: { 'component/v1.0.0': { path: 'x', sourceSha256: SHA, publishedSha256: SHA } },
    }
    expect(appendOnly(v1, base)[0]).toContain('Only an empty version 1 ledger')
  })
})

describe('reading', () => {
  test('an absent file is the empty ledger, at a ref and in the working tree', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.writeFile('README.md', '# fixture\n')
    fx.commit('docs: start')
    expect(readLedger(fx.root)).toEqual(EMPTY_LEDGER)
    expect(ledgerAtRef(fx.root, 'HEAD')).toEqual(EMPTY_LEDGER)
  })

  test('a version 1 ledger at a ref reads back as version 1', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.setLedger({ version: 1, releases: {} })
    fx.commit('chore: the old ledger')
    expect(ledgerAtRef(fx.root, 'HEAD')).toEqual({ version: 1, releases: {} })
  })

  test('a ref that does not resolve fails rather than reading as empty', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.setLedger({ version: 2, releases: {} })
    fx.commit('chore: ledger')
    expect(() => ledgerAtRef(fx.root, 'origin/never-fetched')).toThrow(/failed/)
  })

  test('an invalid working ledger throws every problem', () => {
    const fx = new FixtureRepo()
    repo = fx
    fx.setLedger({ version: 2, releases: { 'core/v1.0.0': { ...coreEntry, bundleSha256: SHA } } })
    expect(() => readLedger(fx.root)).toThrow(new RegExp(`${LEDGER_FILE}: releases/core/v1.0.0`))
  })
})
