/**
 * Hold the three copies of the Conventional Commits vocabulary in step.
 *
 * `.github/conventional-commits.yaml` calls itself the single source of truth
 * and says it is "consumed by .github/workflows/lint-pr.yml". It is not
 * consumed by anything: the workflow inlines the same lists in its `with:`
 * block, and the .config/lefthook.yml commit-msg hook inlines the types again
 * inside a POSIX regex. Three copies, and a comment asking people to keep them
 * in step.
 *
 * That is the same defect as a ruleset file documenting a rule it does not
 * carry — a claim a reader will believe and not think to check. The lists
 * cannot be read at runtime by the action (its inputs are static YAML) or by
 * the hook (it is a shell regex), so the fix is not to remove the duplication
 * but to make it verifiable: this asserts all three agree, and the file becomes
 * the source of truth by being the one the others are checked against.
 *
 * The scope matters more than it looks. It selects which release train a change
 * belongs to, so a scope accepted by the hook and rejected by CI — or worse,
 * accepted by both and understood by neither — is a release that does not
 * happen.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Failures, REPO_ROOT } from './spec.ts'

const SOURCE = join(REPO_ROOT, '.github', 'conventional-commits.yaml')
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'lint-pr.yml')
const HOOKS = join(REPO_ROOT, '.config', 'lefthook.yml')

/** A `key:` followed by an indented `- item` list, in a small YAML file. */
function yamlList(source: string, key: string): string[] {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trimEnd() === `${key}:`)
  if (start < 0) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    const item = /^\s*-\s+(\S+)\s*$/.exec(line)
    if (item?.[1] !== undefined) {
      items.push(item[1])
      continue
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    break
  }
  return items
}

/** A `key: |` block-scalar whose lines are the values, as the action takes them. */
function blockScalar(source: string, key: string): string[] {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === `${key}: |`)
  if (start < 0) return []
  const indent = (lines[start] as string).search(/\S/)
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue
    if (line.search(/\S/) <= indent) break
    items.push(line.trim())
  }
  return items
}

/** The alternation inside the hook's `pattern="^(a|b|c)…"`. */
function hookTypes(source: string): string[] {
  const match = /pattern="\^\(([a-z|]+)\)/.exec(source)
  return match?.[1] === undefined ? [] : match[1].split('|')
}

function compare(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
  failures: Failures,
): void {
  if (actual.length === 0) {
    failures.add(`${label}: found no vocabulary to compare — the file's shape changed`)
    return
  }
  const missing = expected.filter((item) => !actual.includes(item))
  const extra = actual.filter((item) => !expected.includes(item))
  if (missing.length > 0) {
    failures.add(`${label}: missing ${missing.join(', ')} — present in conventional-commits.yaml`)
  }
  if (extra.length > 0) {
    failures.add(`${label}: has ${extra.join(', ')}, which conventional-commits.yaml does not list`)
  }
}

function main(): void {
  const failures = new Failures()
  const source = readFileSync(SOURCE, 'utf8')
  const types = yamlList(source, 'types')
  const scopes = yamlList(source, 'scopes')

  if (types.length === 0 || scopes.length === 0) {
    failures.add('.github/conventional-commits.yaml declares no types or no scopes')
    failures.report('')
    return
  }

  const workflow = readFileSync(WORKFLOW, 'utf8')
  compare('lint-pr.yml types', types, blockScalar(workflow, 'types'), failures)
  compare('lint-pr.yml scopes', scopes, blockScalar(workflow, 'scopes'), failures)

  // The hook checks types only — a scope is optional, and the hook's own error
  // text lists the scopes for a human rather than enforcing them.
  compare(
    '.config/lefthook.yml commit-msg types',
    types,
    hookTypes(readFileSync(HOOKS, 'utf8')),
    failures,
  )

  failures.report(
    `Conventional Commits vocabulary agrees across 3 file(s): ${types.length} type(s), ` +
      `${scopes.length} scope(s).`,
  )
}

if (import.meta.main) main()
