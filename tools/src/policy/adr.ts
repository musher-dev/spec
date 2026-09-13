/**
 * Hold the architecture decision records to their own shape, and hold an
 * accepted one to link-target-only edits.
 *
 * An ADR is cited by number and by section. Other ADRs refine "ADR 0001 §7",
 * governance prose points at "0021 §4", and a reader follows the chain back to
 * the decision. That chain is only worth something if the numbers are
 * contiguous, the relation bullets point at files that exist, the sections they
 * name are really there, and the text they cite still says what it said when it
 * was cited.
 *
 * The last of those is ADR 0021 §4: an accepted ADR's prose is immutable, but a
 * relative link target that moved may be rewritten. ADR-04 is that rule made
 * mechanical — both sides of the comparison have every `](target)` blanked to
 * `]()`, and anything still different is an edit to a decision.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, listTreeFiles, readBlobAtRef } from '../lib/git.ts'
import { ADR_DIR, ADR_INDEX_FILE, Failures, REPO_ROOT } from '../lib/layout.ts'

/** The index `render/adr-index.ts` generates, which is not itself an ADR. */
const INDEX_NAME = ADR_INDEX_FILE.slice(ADR_DIR.length + 1)

/** `0021-repository-organized-around-the-family-version.md`. */
export const FILENAME = /^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/
/** `# ADR 0021: Title`. */
export const TITLE = /^# ADR (\d{4}): \S/
export const STATUS = /^- \*\*Status:\*\* (Accepted|Proposed|Superseded\b.*)$/
export const DATE = /^- \*\*Date:\*\* \d{4}-\d{2}-\d{2}$/
/** The relation bullets whose links must land on another ADR. */
export const RELATION = /^- \*\*(Supersedes|Refines|Extends|Relies on|Closes):\*\*/
/** `[text](target)`, with the target captured. */
export const LINK = /\[[^\]]*\]\(([^)\s]*)\)/g
/** A section citation, `§3`. */
export const SECTION = /§(\d+)/g
/** A numbered heading: `### 3. Title` or `### 3 Title`. */
const NUMBERED_HEADING = /^#{2,6}\s+(\d+)(?:\.|\s)/gm
/** A scheme-qualified URL — not a path in this repository. */
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i

/** An ADR's header: every line after the H1 and before the first `## `. */
export function headerLines(text: string): string[] {
  const lines = text.split('\n').slice(1)
  const end = lines.findIndex((line) => line.startsWith('## '))
  return end === -1 ? lines : lines.slice(0, end)
}

/** The numbers of every numbered heading in an ADR. */
function sectionNumbers(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(NUMBERED_HEADING), (match) => match[1] as string))
}

/**
 * The text ADR-04 compares: every Markdown link target blanked, so a retargeted
 * link reads as unchanged and any other difference does not.
 */
export function normalizeLinkTargets(text: string): string {
  return text.replace(/\]\([^)]*\)/g, ']()')
}

/** The 1-based line of the first difference between two texts. */
function firstDifferingLine(a: string, b: string): number {
  const left = a.split('\n')
  const right = b.split('\n')
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) if (left[i] !== right[i]) return i + 1
  return length
}

/**
 * The ref ADR-04 compares against: `BASE_REF` when set, else `origin/main` when
 * it exists, else null — and ADR-04 is skipped with a notice.
 */
export function resolveBaseRef(
  repoRoot: string = REPO_ROOT,
  env: { readonly [key: string]: string | undefined } = process.env,
): string | null {
  const explicit = env.BASE_REF
  if (explicit !== undefined && explicit !== '') return explicit
  try {
    git(repoRoot, ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'])
    return 'origin/main'
  } catch (error) {
    // `--quiet` makes an absent ref exit 1 with nothing on stderr. Anything
    // else — not a repository, an ownership refusal — is git failing, and
    // reporting it as "origin/main absent" would skip ADR-04 silently.
    const message = error instanceof Error ? error.message : String(error)
    if (/failed \(1\) — $/.test(message)) return null
    throw error
  }
}

/** ADR-01..ADR-03, against the working tree. */
function shapeViolations(repoRoot: string): string[] {
  const problems: string[] = []
  const dir = join(repoRoot, ADR_DIR)
  if (!existsSync(dir)) return [`ADR-01: ${ADR_DIR}/ does not exist.`]

  const names = readdirSync(dir)
    .filter((name) => name !== INDEX_NAME)
    .sort()
  const records = new Map<string, string>()
  for (const name of names) {
    if (!FILENAME.test(name)) {
      problems.push(
        `ADR-01: ${ADR_DIR}/${name} is not named NNNN-kebab-case-title.md. The number is ` +
          'how every other document cites it.',
      )
      continue
    }
    records.set(name, readFileSync(join(dir, name), 'utf8'))
  }

  const seen = new Map<number, string>()
  for (const name of records.keys()) {
    const number = Number(name.slice(0, 4))
    const earlier = seen.get(number)
    if (earlier !== undefined) {
      problems.push(
        `ADR-02: ${ADR_DIR}/${name} reuses number ${name.slice(0, 4)}, already taken by ${earlier}.`,
      )
      continue
    }
    seen.set(number, name)
  }
  const numbers = [...seen.keys()].sort((a, b) => a - b)
  for (const [index, number] of numbers.entries()) {
    const expected = index + 1
    if (number === expected) continue
    problems.push(
      `ADR-02: ${ADR_DIR}/${seen.get(number)} is numbered ${String(number).padStart(4, '0')}, ` +
        `but the sequence expects ${String(expected).padStart(4, '0')}. ADR numbers are ` +
        'contiguous from 0001.',
    )
    // Report the gap once, not once per file after it.
    break
  }

  for (const [name, text] of records) {
    const path = `${ADR_DIR}/${name}`
    const title = TITLE.exec(text.split('\n')[0] ?? '')
    if (title === null) {
      problems.push(`ADR-02: ${path} does not open with "# ADR ${name.slice(0, 4)}: <title>".`)
    } else if (title[1] !== name.slice(0, 4)) {
      problems.push(
        `ADR-02: ${path} is titled ADR ${title[1]}, but its filename says ${name.slice(0, 4)}.`,
      )
    }

    const header = headerLines(text)
    if (!header.some((line) => STATUS.test(line))) {
      problems.push(
        `ADR-03: ${path} has no "- **Status:** Accepted|Proposed|Superseded…" line in its header.`,
      )
    }
    if (!header.some((line) => DATE.test(line))) {
      problems.push(`ADR-03: ${path} has no "- **Date:** YYYY-MM-DD" line in its header.`)
    }

    for (const line of header) {
      if (!RELATION.test(line) && !STATUS.test(line)) continue
      const links = Array.from(line.matchAll(LINK))
      links.forEach((link, index) => {
        const target = link[1] as string
        // A relation may close an issue; a URL is not a claim about this directory.
        if (ABSOLUTE.test(target)) return
        const file = target.replace(/^\.\//, '').split('#')[0] as string
        if (!FILENAME.test(file)) {
          problems.push(
            `ADR-03: ${path} relation "${line}" links ${target}, which is not an ADR in ${ADR_DIR}/.`,
          )
          return
        }
        const cited = records.get(file)
        if (cited === undefined) {
          problems.push(`ADR-03: ${path} relation "${line}" links ${target}, which does not exist.`)
          return
        }
        const start = (link.index ?? 0) + link[0].length
        const end = links[index + 1]?.index ?? line.length
        const sections = sectionNumbers(cited)
        for (const section of line.slice(start, end).matchAll(SECTION)) {
          if (sections.has(section[1] as string)) continue
          problems.push(
            `ADR-03: ${path} cites ${file} §${section[1]}, which has no heading numbered ` +
              `${section[1]}.`,
          )
        }
      })
    }
  }

  return problems
}

/**
 * ADR-04: every ADR accepted at the base differs from the working tree only in
 * link targets. ADRs new since the base, or not yet accepted there, are exempt.
 */
function immutabilityViolations(repoRoot: string, baseRef: string): string[] {
  let base: string
  try {
    git(repoRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  } catch {
    return [
      `ADR-04: base ref ${baseRef} does not resolve. The comparison needs history — ` +
        'check out with fetch-depth: 0, or unset BASE_REF.',
    ]
  }
  // The merge base, so a branch that is merely behind its base is not read as
  // having deleted what landed there since.
  try {
    base = git(repoRoot, ['merge-base', baseRef, 'HEAD'])
  } catch {
    base = baseRef
  }

  const problems: string[] = []
  for (const path of listTreeFiles(repoRoot, base, ADR_DIR)) {
    const name = path.slice(ADR_DIR.length + 1)
    if (name.includes('/') || !FILENAME.test(name)) continue
    const before = readBlobAtRef(repoRoot, base, path)?.toString('utf8')
    if (before === undefined) continue
    if (!headerLines(before).some((line) => /^- \*\*Status:\*\* Accepted\s*$/.test(line))) continue

    const absolute = join(repoRoot, path)
    if (!existsSync(absolute)) {
      problems.push(
        `ADR-04: ${path} was accepted at ${baseRef} and has been removed. An accepted ADR is ` +
          'superseded by a new one, never deleted.',
      )
      continue
    }
    const left = normalizeLinkTargets(before)
    const right = normalizeLinkTargets(readFileSync(absolute, 'utf8'))
    if (left === right) continue
    problems.push(
      `ADR-04: ${path} was accepted at ${baseRef} and has changed beyond its link targets ` +
        `(first at line ${firstDifferingLine(left, right)}). Accepted prose is immutable — ` +
        'record the change in a new ADR (ADR 0021 §4).',
    )
  }
  return problems
}

/**
 * Every violation, as `ADR-NN: <what>` messages. `baseRef` null skips ADR-04.
 *
 * Exported and taking `repoRoot` so the test suite can exercise each rule
 * against a throwaway repository rather than against this one.
 */
export function adrViolations(
  repoRoot: string = REPO_ROOT,
  baseRef: string | null = null,
): string[] {
  const problems = shapeViolations(repoRoot)
  if (baseRef !== null) problems.push(...immutabilityViolations(repoRoot, baseRef))
  return problems
}

function main(): void {
  const baseRef = resolveBaseRef()
  if (baseRef === null) {
    console.log('BASE_REF not set and origin/main absent — skipping ADR-04.')
  }
  const failures = new Failures()
  for (const problem of adrViolations(REPO_ROOT, baseRef)) failures.add(problem)
  failures.report(
    baseRef === null
      ? `${ADR_DIR}/ is intact (ADR-01..ADR-03).`
      : `${ADR_DIR}/ is intact against ${baseRef} (ADR-01..ADR-04).`,
  )
}

if (import.meta.main) main()
