/**
 * The index reads each header, condenses its relations, and computes what an
 * accepted ADR cannot say about itself: which later ADRs replaced it.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { ADR_DIR, ADR_INDEX_FILE } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import {
  backReferences,
  buildAdrIndex,
  INDEX_END,
  INDEX_START,
  parseAdr,
  readAdrRecords,
  spliceIndex,
} from './adr-index.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

const FIRST = [
  '# ADR 0001: The first decision',
  '',
  '- **Status:** Accepted',
  '- **Date:** 2026-01-01',
  '- **Supersedes:** the old repository',
  '',
  '## Context',
  '',
  '### 1. One',
  '',
  '### 2. Two',
  '',
].join('\n')

const SECOND = [
  '# ADR 0002: A pipe | in a title',
  '',
  '- **Status:** Accepted',
  '- **Date:** 2026-01-02',
  '- **Supersedes:** [ADR 0001](0001-first.md) §1, only the name; §2',
  '- **Closes:** [ADR 0001](0001-first.md) follow-up 3',
  '',
  '## Context',
  '',
].join('\n')

const THIRD = [
  '# ADR 0003: The third',
  '',
  '- **Status:** Proposed',
  '- **Date:** 2026-01-03',
  '- **Refines:** [ADR 0001](0001-first.md), [ADR 0002](0002-second.md) §4',
  '',
  '## Context',
  '',
].join('\n')

const INTRO = `# Decisions\n\nHand-written.\n\n${INDEX_START}\n${INDEX_END}\n`

function writeRecords(fx: FixtureRepo, order: readonly string[] = ['1', '2', '3']): void {
  const files: { [key: string]: [string, string] } = {
    '1': ['0001-first.md', FIRST],
    '2': ['0002-second.md', SECOND],
    '3': ['0003-third.md', THIRD],
  }
  for (const key of order) {
    const [name, text] = files[key] as [string, string]
    fx.writeFile(`${ADR_DIR}/${name}`, text)
  }
  fx.writeFile(ADR_INDEX_FILE, INTRO)
}

describe('parseAdr', () => {
  test('condenses relations to the cited ADR and the sections and follow-ups named', () => {
    const record = parseAdr('0002-second.md', SECOND)
    expect(record?.title).toBe('A pipe | in a title')
    expect(record?.relations.map((r) => [r.verb, r.file, r.parts])).toEqual([
      ['Supersedes', '0001-first.md', ['§1', '§2']],
      ['Closes', '0001-first.md', ['follow-up 3']],
    ])
  })

  test('keeps a relation that names no ADR as written', () => {
    const record = parseAdr('0001-first.md', FIRST)
    expect(record?.relations).toEqual([
      { verb: 'Supersedes', file: null, parts: [], text: 'the old repository' },
    ])
  })

  test('returns null for the README and for a header without a date', () => {
    expect(parseAdr('README.md', INTRO)).toBeNull()
    expect(parseAdr('0001-first.md', FIRST.replace('- **Date:** 2026-01-01\n', ''))).toBeNull()
  })
})

describe('backReferences', () => {
  test('computes superseded-by and refined-by from other ADRs, supersessions first', () => {
    const fx = new FixtureRepo()
    repo = fx
    writeRecords(fx)
    const back = backReferences(readAdrRecords(fx.root))
    expect(back.get('0001-first.md')).toEqual([
      '§1, §2 superseded by [0002](0002-second.md)',
      'Refined by [0003](0003-third.md)',
    ])
    expect(back.get('0002-second.md')).toEqual(['§4 refined by [0003](0003-third.md)'])
    // Closes is a relation, not a supersession or a refinement.
    expect(back.has('0003-third.md')).toBe(false)
  })
})

describe('buildAdrIndex', () => {
  test('keeps the introduction, escapes cells, and writes one row per ADR', () => {
    const fx = new FixtureRepo()
    repo = fx
    writeRecords(fx)
    const index = buildAdrIndex(fx.root)
    expect(index.startsWith('# Decisions\n\nHand-written.\n\n')).toBe(true)
    expect(index).toContain(
      '| [0001](0001-first.md) | The first decision | Accepted | 2026-01-01 | ' +
        'Supersedes the old repository | §1, §2 superseded by [0002](0002-second.md); ' +
        'Refined by [0003](0003-third.md) |',
    )
    expect(index).toContain('| A pipe \\| in a title |')
    expect(index).toContain(
      '| Proposed | 2026-01-03 | Refines [0001](0001-first.md); Refines [0002](0002-second.md) §4 | — |',
    )
  })

  test('is deterministic: the same tree, written in any order, regenerates identically', () => {
    const a = new FixtureRepo()
    const b = new FixtureRepo()
    try {
      writeRecords(a, ['1', '2', '3'])
      writeRecords(b, ['3', '1', '2'])
      const once = buildAdrIndex(a.root)
      expect(buildAdrIndex(b.root)).toBe(once)
      // Regenerating over its own output changes nothing.
      a.writeFile(ADR_INDEX_FILE, once)
      expect(buildAdrIndex(a.root)).toBe(once)
    } finally {
      a.cleanup()
      b.cleanup()
    }
  })

  test('refuses a README without both markers', () => {
    expect(() => spliceIndex('# Decisions\n', 'table')).toThrow(INDEX_START)
  })
})
