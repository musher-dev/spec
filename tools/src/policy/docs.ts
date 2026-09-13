/**
 * Fail if a generated navigation document is stale — `task check:docs`.
 *
 * `docs/traceability.md` and the ADR index in `docs/adr/README.md` are
 * generated but committed, because they are read in the repository browser
 * where nothing builds (ADR 0021 §5). A committed copy is only worth reading if
 * it is current, so this regenerates both in memory and compares them with the
 * working tree. It writes nothing: `task docs` is the fix.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readFileSync } from 'node:fs'
import { ADR_INDEX_FILE, Failures, inRepo, REPO_ROOT, TRACEABILITY_FILE } from '../lib/layout.ts'
import { buildAdrIndex } from '../render/adr-index.ts'
import { buildMatrix } from '../render/traceability.ts'

/** Every generated document, repo-relative, with the bytes it should hold. */
function generatedDocs(repoRoot: string): [string, () => string][] {
  return [
    [TRACEABILITY_FILE, () => buildMatrix(repoRoot)],
    [ADR_INDEX_FILE, () => buildAdrIndex(repoRoot)],
  ]
}

/** One message per document that is stale or cannot be generated, naming the file. */
export function staleDocs(repoRoot: string = REPO_ROOT): string[] {
  const problems: string[] = []
  for (const [path, build] of generatedDocs(repoRoot)) {
    const absolute = inRepo(repoRoot, path)
    let expected: string
    try {
      expected = build()
    } catch (error) {
      problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!existsSync(absolute)) {
      problems.push(`${path} does not exist. Run \`task docs\` and commit it.`)
      continue
    }
    if (readFileSync(absolute, 'utf8') !== expected) {
      problems.push(`${path} is stale. Run \`task docs\` and commit the result.`)
    }
  }
  return problems
}

function main(): void {
  const failures = new Failures()
  for (const problem of staleDocs()) failures.add(problem)
  failures.report(`${TRACEABILITY_FILE} and ${ADR_INDEX_FILE} are current.`)
}

if (import.meta.main) main()
