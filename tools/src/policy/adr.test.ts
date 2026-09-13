/**
 * Each ADR rule, exercised against a throwaway repository.
 *
 * ADR-04 compares against a git ref, so the corpus is committed and then edited
 * in the working tree — the same shape as a branch under review.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FixtureRepo } from '../testing/fixture.ts'
import { adrViolations, isRelativeTarget, normalizeLinkTargets, resolveBaseRef } from './adr.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

const FIRST = [
  '# ADR 0001: The first decision',
  '',
  '- **Status:** Accepted',
  '- **Date:** 2026-08-08',
  '',
  '## Context',
  '',
  'See [the README](../../README.md) for why.',
  '',
  '## Decision',
  '',
  '### 1. One thing',
  '',
  'It is decided.',
  '',
  '### 2. Another thing',
  '',
  'Also decided.',
  '',
].join('\n')

const SECOND = [
  '# ADR 0002: The second decision',
  '',
  '- **Status:** Accepted',
  '- **Date:** 2026-08-09',
  '- **Extends:** [ADR 0001](0001-the-first-decision.md) §1, §2',
  '- **Closes:** [#81](https://github.com/musher-dev/specifications/issues/81)',
  '',
  '## Context',
  '',
  'Nothing more.',
  '',
].join('\n')

/** A committed corpus that satisfies every rule. */
function intact(): FixtureRepo {
  repo = new FixtureRepo()
  repo.writeFile('docs/adr/README.md', '# Decisions\n')
  repo.writeFile('docs/adr/0001-the-first-decision.md', FIRST)
  repo.writeFile('docs/adr/0002-the-second-decision.md', SECOND)
  repo.commit('docs: seed ADRs')
  return repo
}

/** The codes reported, so a case asserts on the rule rather than the prose. */
function codes(root: string, base: string | null = null): string[] {
  return adrViolations(root, base).map((problem) => problem.slice(0, 6))
}

describe('an intact corpus', () => {
  test('reports nothing, against itself as the base', () => {
    const fx = intact()
    expect(adrViolations(fx.root, fx.head())).toEqual([])
  })
})

describe('ADR-01 — filenames', () => {
  test('fires for a file not named NNNN-kebab.md', () => {
    const fx = intact()
    fx.writeFile('docs/adr/0003_Bad_Name.md', '# ADR 0003: Bad\n')
    expect(codes(fx.root)).toEqual(['ADR-01'])
  })
})

describe('ADR-02 — numbering and titles', () => {
  test('fires for a gap in the sequence', () => {
    const fx = intact()
    fx.writeFile('docs/adr/0004-skips-a-number.md', SECOND.replace('ADR 0002:', 'ADR 0004:'))
    expect(codes(fx.root)).toEqual(['ADR-02'])
  })

  test('fires when the title number disagrees with the filename', () => {
    const fx = intact()
    fx.writeFile('docs/adr/0003-wrong-title.md', SECOND)
    expect(codes(fx.root)).toEqual(['ADR-02'])
  })
})

describe('ADR-03 — header and relations', () => {
  test('fires for a missing status', () => {
    const fx = intact()
    fx.writeFile(
      'docs/adr/0003-no-status.md',
      SECOND.replace('ADR 0002:', 'ADR 0003:').replace('- **Status:** Accepted\n', ''),
    )
    expect(codes(fx.root)).toEqual(['ADR-03'])
  })

  test('fires for a relation linking an ADR that does not exist', () => {
    const fx = intact()
    fx.writeFile(
      'docs/adr/0003-dangling.md',
      SECOND.replace('ADR 0002:', 'ADR 0003:').replace(
        '(0001-the-first-decision.md) §1, §2',
        '(0009-never-written.md)',
      ),
    )
    expect(codes(fx.root)).toEqual(['ADR-03'])
  })

  test('fires for a cited section with no numbered heading', () => {
    const fx = intact()
    fx.writeFile(
      'docs/adr/0003-bad-section.md',
      SECOND.replace('ADR 0002:', 'ADR 0003:').replace('§1, §2', '§7'),
    )
    expect(adrViolations(fx.root)).toEqual([
      'ADR-03: docs/adr/0003-bad-section.md cites 0001-the-first-decision.md §7, which has no heading numbered 7.',
    ])
  })
})

describe('ADR-04 — accepted ADRs change only link targets', () => {
  test('fires for a prose edit to an accepted ADR', () => {
    const fx = intact()
    const base = fx.head()
    fx.writeFile(
      'docs/adr/0001-the-first-decision.md',
      FIRST.replace('It is decided.', 'It is undecided.'),
    )
    const problems = adrViolations(fx.root, base)
    expect(problems.map((p) => p.slice(0, 6))).toEqual(['ADR-04'])
    expect(problems[0]).toContain('docs/adr/0001-the-first-decision.md')
  })

  test('passes when only a link target changed', () => {
    const fx = intact()
    const base = fx.head()
    fx.writeFile(
      'docs/adr/0001-the-first-decision.md',
      FIRST.replace('(../../README.md)', '(../../specifications/README.md#families)'),
    )
    expect(adrViolations(fx.root, base)).toEqual([])
  })

  test('fires when an accepted ADR is removed', () => {
    const fx = intact()
    const base = fx.head()
    fx.remove('docs/adr/0002-the-second-decision.md')
    expect(codes(fx.root, base)).toEqual(['ADR-04'])
  })

  test('exempts an ADR that is new since the base', () => {
    const fx = intact()
    const base = fx.head()
    fx.writeFile('docs/adr/0003-brand-new.md', SECOND.replace('ADR 0002:', 'ADR 0003:'))
    fx.commit('docs: add ADR 0003')
    fx.writeFile(
      'docs/adr/0003-brand-new.md',
      SECOND.replace('ADR 0002:', 'ADR 0003:').replace('Nothing more.', 'Rewritten freely.'),
    )
    expect(adrViolations(fx.root, base)).toEqual([])
  })

  test('link-target normalisation blanks relative targets and nothing else', () => {
    expect(normalizeLinkTargets('[a](x.md#y) and [b](../c/d.md) and [e](#f) text')).toBe(
      '[a]() and [b]() and [e]() text',
    )
  })

  test('an absolute URL is compared verbatim, so changing one is a change', () => {
    const text = '[a](https://z.example/p) [b](mailto:x@example.invalid) [c](//cdn.example/x)'
    expect(normalizeLinkTargets(text)).toBe(text)
    expect(normalizeLinkTargets('[a](https://z.example/p)')).not.toBe(
      normalizeLinkTargets('[a](https://other.example/p)'),
    )
  })

  test('isRelativeTarget', () => {
    expect(isRelativeTarget('0001-first.md')).toBe(true)
    expect(isRelativeTarget('#anchor')).toBe(true)
    expect(isRelativeTarget('<../x.md>')).toBe(true)
    expect(isRelativeTarget('https://example.invalid')).toBe(false)
    expect(isRelativeTarget('//example.invalid/x')).toBe(false)
    expect(isRelativeTarget('<https://example.invalid>')).toBe(false)
  })
})

describe('the base ref', () => {
  test('BASE_REF wins when set', () => {
    const fx = intact()
    expect(resolveBaseRef(fx.root, { BASE_REF: 'abc123' })).toBe('abc123')
  })

  test('is null without BASE_REF or origin/main', () => {
    const fx = intact()
    expect(resolveBaseRef(fx.root, { BASE_REF: '' })).toBeNull()
  })

  test('throws, rather than skipping ADR-04, when git itself fails', () => {
    const notARepository = mkdtempSync(join(tmpdir(), 'adr-no-repo-'))
    try {
      expect(() => resolveBaseRef(notARepository, { BASE_REF: '' })).toThrow()
    } finally {
      rmSync(notARepository, { recursive: true, force: true })
    }
  })
})
