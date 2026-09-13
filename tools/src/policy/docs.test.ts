/**
 * `check:docs` passes on freshly generated documents and names the file that
 * has gone stale.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { ADR_DIR, ADR_INDEX_FILE, TRACEABILITY_FILE } from '../lib/layout.ts'
import { buildAdrIndex, INDEX_END, INDEX_START } from '../render/adr-index.ts'
import { buildMatrix } from '../render/traceability.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { staleDocs } from './docs.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

const ADR = [
  '# ADR 0001: A decision',
  '',
  '- **Status:** Accepted',
  '- **Date:** 2026-01-01',
  '',
  '## Context',
  '',
].join('\n')

/** A repository whose generated documents are current. */
function freshRepo(): FixtureRepo {
  const fx = new FixtureRepo()
  fx.writeFile(`${ADR_DIR}/0001-a-decision.md`, ADR)
  fx.writeFile(ADR_INDEX_FILE, `# Decisions\n\n${INDEX_START}\n${INDEX_END}\n`)
  fx.writeFile(ADR_INDEX_FILE, buildAdrIndex(fx.root))
  fx.writeFile(TRACEABILITY_FILE, buildMatrix(fx.root))
  return fx
}

describe('staleDocs', () => {
  test('passes when both documents match a fresh generation', () => {
    repo = freshRepo()
    expect(staleDocs(repo.root)).toEqual([])
  })

  test('names the ADR index when a new ADR is not in it', () => {
    repo = freshRepo()
    repo.writeFile(`${ADR_DIR}/0002-another.md`, ADR.replace('0001: A decision', '0002: Another'))
    expect(staleDocs(repo.root)).toEqual([
      `${ADR_INDEX_FILE} is stale. Run \`task docs\` and commit the result.`,
    ])
  })

  test('names the traceability matrix when it was edited by hand', () => {
    repo = freshRepo()
    repo.writeFile(TRACEABILITY_FILE, `${buildMatrix(repo.root)}\nhand edit\n`)
    const problems = staleDocs(repo.root)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toStartWith(`${TRACEABILITY_FILE} is stale`)
  })

  test('reports an index whose markers are gone, rather than throwing', () => {
    repo = freshRepo()
    repo.writeFile(ADR_INDEX_FILE, '# Decisions\n')
    const problems = staleDocs(repo.root)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toStartWith(`${ADR_INDEX_FILE}: `)
  })
})
