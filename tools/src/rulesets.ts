/**
 * Keep the two halves of the selective code-owner review gate in step.
 *
 * The gate is one mechanism split across two files. `.github/rulesets/
 * main-branch.json` pairs `required_approving_review_count: 0` with
 * `require_code_owner_review: true`, so review is demanded per changed file
 * rather than per pull request; `.github/CODEOWNERS` decides which files those
 * are. Break either half and the other becomes meaningless — but neither fails
 * loudly. A `*` catch-all restores the blanket gate. A count of `1` restores it
 * from the other side. Both changes look like tightening and read as harmless.
 *
 * The ruleset files are also `PUT` back to GitHub verbatim, which makes them
 * the rare config where a shape error is discovered in production: a leaked
 * server-side field makes the apply fail, and a mistyped required-check context
 * makes every pull request hang forever waiting for a check that will never
 * report. RUL-03 and RUL-09 are those two failure modes.
 *
 * RUL-09 has no counterpart in `musher-dev/platform`, which documents the rule
 * in prose and enforces nothing. It is the reason this runs inside the existing
 * `Lint` job rather than as its own workflow: a required check that lives in a
 * `paths:`-filtered workflow is the very hang it exists to prevent.
 *
 * See docs/adr/0015-selective-code-owner-review.md and
 * .github/rulesets/RULESETS.md.
 *
 * NON-NORMATIVE, like everything under tools/. Throwaway edit: verifying that
 * a pull request touching no owned path merges without a review.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { Failures, REPO_ROOT } from './spec.ts'

const RULESETS_DIR = join('.github', 'rulesets')
const CODEOWNERS = join('.github', 'CODEOWNERS')
const WORKFLOWS_DIR = join('.github', 'workflows')

/** The ruleset carrying the review gate. Named because RUL-07/08 only apply to it. */
const MAIN_RULESET = 'main-branch.json'

const VALID_TARGETS = ['branch', 'tag', 'push', 'repository']
const VALID_ENFORCEMENT = ['active', 'disabled', 'evaluate']

/**
 * Fields `GET /rulesets/{id}` adds and `PUT` rejects. Committing one is how a
 * re-export of live state turns into an apply that fails at the API.
 */
const SERVER_SIDE_FIELDS = [
  'id',
  'node_id',
  'source',
  'source_type',
  'current_user_can_bypass',
  '_links',
  'created_at',
  'updated_at',
]

/** `@user` or `@org/team`. GitHub also allows a bare email; we do not. */
const OWNER_PATTERN = /^@[A-Za-z0-9][A-Za-z0-9-]*(\/[A-Za-z0-9._-]+)?$/

interface CodeownersEntry {
  readonly line: number
  readonly pattern: string
  readonly owners: string[]
}

/** Strip comments and blanks; return one entry per meaningful line. */
function parseCodeowners(text: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const stripped = (lines[i] ?? '').replace(/#.*$/, '').trim()
    if (stripped === '') continue
    const [pattern, ...owners] = stripped.split(/\s+/)
    if (pattern === undefined) continue
    entries.push({ line: i + 1, pattern, owners })
  }
  return entries
}

/**
 * Every job name a workflow publishes as a check context, and whether that
 * workflow filters by path.
 *
 * A job with no `name:` reports under its key, which is what GitHub does. Only
 * `paths`/`paths-ignore` matter: a `branches:` filter still reports on every
 * pull request targeting that branch.
 */
interface WorkflowContexts {
  readonly contexts: Map<string, string>
  readonly pathFiltered: Set<string>
}

function workflowContexts(repoRoot: string): WorkflowContexts {
  const contexts = new Map<string, string>()
  const pathFiltered = new Set<string>()
  const dir = join(repoRoot, WORKFLOWS_DIR)
  if (!existsSync(dir)) return { contexts, pathFiltered }

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue
    let doc: unknown
    try {
      doc = parse(readFileSync(join(dir, file), 'utf8'))
    } catch {
      continue // check:workflow owns YAML validity; do not double-report.
    }
    if (typeof doc !== 'object' || doc === null) continue
    const workflow = doc as Record<string, unknown>

    // YAML 1.2 keeps `on` a string, but a 1.1-minded editor may yield `true`.
    const triggers = (workflow.on ?? workflow.true) as Record<string, unknown> | undefined
    const filtered =
      typeof triggers === 'object' &&
      triggers !== null &&
      Object.values(triggers).some(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          ('paths' in event || 'paths-ignore' in event),
      )

    const jobs = workflow.jobs as Record<string, unknown> | undefined
    if (typeof jobs !== 'object' || jobs === null) continue
    for (const [id, job] of Object.entries(jobs)) {
      const name =
        typeof job === 'object' &&
        job !== null &&
        typeof (job as { name?: unknown }).name === 'string'
          ? (job as { name: string }).name
          : id
      contexts.set(name, file)
      if (filtered) pathFiltered.add(name)
    }
  }
  return { contexts, pathFiltered }
}

export function rulesetViolations(repoRoot: string = REPO_ROOT): string[] {
  const problems: string[] = []
  const dir = join(repoRoot, RULESETS_DIR)

  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : []

  if (files.length === 0) {
    problems.push(
      `RUL-01: no ruleset files under ${RULESETS_DIR}/. Branch and tag protection ` +
        'would then live only in the GitHub UI, where it cannot be reviewed or restored.',
    )
  }

  const { contexts, pathFiltered } = workflowContexts(repoRoot)

  for (const file of files) {
    const rel = `${RULESETS_DIR}/${file}`
    let ruleset: Record<string, unknown>
    try {
      ruleset = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (error) {
      problems.push(`RUL-01: ${rel} is not valid JSON — ${(error as Error).message}`)
      continue
    }

    for (const key of ['name', 'target', 'enforcement', 'rules']) {
      if (!(key in ruleset)) problems.push(`RUL-01: ${rel} is missing the required key \`${key}\`.`)
    }

    const target = ruleset.target
    if (typeof target === 'string' && !VALID_TARGETS.includes(target)) {
      problems.push(
        `RUL-02: ${rel} has target \`${target}\`; expected ${VALID_TARGETS.join(' | ')}.`,
      )
    }

    const enforcement = ruleset.enforcement
    if (typeof enforcement === 'string' && !VALID_ENFORCEMENT.includes(enforcement)) {
      problems.push(
        `RUL-02: ${rel} has enforcement \`${enforcement}\`; expected ${VALID_ENFORCEMENT.join(' | ')}.`,
      )
    }

    for (const field of SERVER_SIDE_FIELDS) {
      if (field in ruleset) {
        problems.push(
          `RUL-03: ${rel} carries the server-side field \`${field}\`. GET adds it and PUT ` +
            'rejects it, so applying this file would fail. Strip it before committing.',
        )
      }
    }

    const rules = ruleset.rules
    if (!Array.isArray(rules) || rules.length === 0) {
      problems.push(`RUL-04: ${rel} has an empty \`rules\` array, which protects nothing.`)
      continue
    }

    const typed = rules.filter(
      (rule): rule is Record<string, unknown> => typeof rule === 'object' && rule !== null,
    )

    if (file === MAIN_RULESET) {
      const pull = typed.find((rule) => rule.type === 'pull_request')
      if (pull === undefined) {
        problems.push(`RUL-07: ${rel} has no \`pull_request\` rule — the review gate is gone.`)
      } else {
        const parameters = (pull.parameters ?? {}) as Record<string, unknown>
        if (parameters.require_code_owner_review !== true) {
          problems.push(
            `RUL-07: ${rel} must set \`require_code_owner_review: true\`. It is the half of ` +
              'the gate that makes CODEOWNERS mean anything.',
          )
        }
        if (parameters.required_approving_review_count !== 0) {
          problems.push(
            `RUL-07: ${rel} must set \`required_approving_review_count: 0\`. A nonzero count ` +
              're-imposes blanket review on pull requests that own no code.',
          )
        }
        if (parameters.require_last_push_approval !== false) {
          problems.push(
            `RUL-08: ${rel} must keep \`require_last_push_approval: false\`. Combined with ` +
              'zero required approvals it produces a state no pull request can ever satisfy.',
          )
        }
      }
    }

    for (const rule of typed) {
      if (rule.type !== 'required_status_checks') continue
      const parameters = (rule.parameters ?? {}) as Record<string, unknown>
      const checks = parameters.required_status_checks
      if (!Array.isArray(checks)) continue
      for (const check of checks) {
        const context = (check as { context?: unknown }).context
        if (typeof context !== 'string') continue
        const source = contexts.get(context)
        if (source === undefined) {
          problems.push(
            `RUL-09: ${rel} requires the check \`${context}\`, which no job in ` +
              `${WORKFLOWS_DIR}/ publishes. A required context that never reports leaves every ` +
              'pull request permanently unmergeable.',
          )
        } else if (pathFiltered.has(context)) {
          problems.push(
            `RUL-09: ${rel} requires \`${context}\`, published by ${WORKFLOWS_DIR}/${source}, ` +
              'which filters on `paths:`. It will not report on a pull request the filter ' +
              'misses, and that pull request hangs forever.',
          )
        }
      }
    }
  }

  problems.push(...codeownersViolations(repoRoot))
  return problems
}

function codeownersViolations(repoRoot: string): string[] {
  const problems: string[] = []
  const path = join(repoRoot, CODEOWNERS)

  if (!existsSync(path)) {
    problems.push(
      `RUL-05: ${CODEOWNERS} is missing. With \`require_code_owner_review: true\` and no ` +
        'ownership registry, the gate protects nothing at all.',
    )
    return problems
  }

  for (const entry of parseCodeowners(readFileSync(path, 'utf8'))) {
    const at = `${CODEOWNERS}:${entry.line}`

    if (entry.pattern === '*') {
      problems.push(
        `RUL-05: ${at} is a \`*\` catch-all. It makes every pull request code-owned and ` +
          'restores the blanket review gate ADR 0015 retired.',
      )
      continue
    }

    for (const owner of entry.owners) {
      if (!OWNER_PATTERN.test(owner)) {
        problems.push(
          `RUL-06: ${at} has the malformed owner \`${owner}\`; expected @user or @org/team.`,
        )
      }
    }

    // A root-anchored literal pattern that matches nothing owns nothing, and
    // CODEOWNERS reports no error for it — the path silently becomes unowned.
    const literal = entry.pattern.startsWith('/') && !/[*?[\]]/.test(entry.pattern)
    if (literal && !existsSync(join(repoRoot, entry.pattern.slice(1)))) {
      problems.push(
        `RUL-06: ${at} points at \`${entry.pattern}\`, which does not exist. CODEOWNERS fails ` +
          'open, so this entry reads as ownership while granting none.',
      )
    }
  }

  return problems
}

function main(): void {
  const failures = new Failures()
  for (const problem of rulesetViolations()) failures.add(problem)
  failures.report('Ruleset and CODEOWNERS halves of the review gate agree (RUL-01..RUL-09).')
}

if (import.meta.main) main()
