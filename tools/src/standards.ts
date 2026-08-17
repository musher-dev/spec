/**
 * Validate the schemas with a toolchain this repository did not write.
 *
 * `check:schema` is Musher policy — closed objects, canonical `$id`s, local
 * refs, naming. It is deliberately opinionated and deliberately ours. What it
 * cannot do is confirm that the documents are valid JSON Schema 2020-12 by
 * anyone else's reading, because it asks Ajv, and Ajv is also what
 * `check:examples` and `check:conformance` ask.
 *
 * The Sourcemeta CLI is a separate implementation, in a different language,
 * with its own reading of the dialect. `metaschema` is the part that must pass:
 * it is an independent second opinion on whether a published bundle is a valid
 * 2020-12 document at all.
 *
 * `lint` is advisory here rather than blocking, and the exclusions below are
 * reviewed rather than assumed — see EXCLUDED_RULES.
 *
 * The CLI is AGPL-3.0. It is used as a development and CI tool only; nothing it
 * produces is distributed, and no schema in this repository derives from it.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { discoverFamilies, Failures, REPO_ROOT, relativeToRepo, sourceModules } from './spec.ts'

const CLI = join(REPO_ROOT, 'tools', 'node_modules', '.bin', 'jsonschema')

/**
 * Sourcemeta lint rules this repository does not adopt, and why.
 *
 * A generic linter encodes one house style. Adopting it wholesale would edit
 * 154 descriptions and 60 enums to satisfy opinions this repository has already
 * decided against — and one of them would change a diagnostic code. So each is
 * listed with a reason a reviewer can disagree with, rather than silenced by
 * turning the linter off.
 */
const EXCLUDED_RULES: ReadonlyMap<string, string> = new Map([
  [
    'description_trailing_period',
    'Descriptions here are sentences and are punctuated as sentences. The rule ' +
      'exists to give interfaces flexibility; this repository would rather the prose ' +
      'read correctly in the 154 places it appears.',
  ],
  [
    'enum_with_type',
    'A `type` beside an `enum` is redundant to a validator and useful to a reader, ' +
      'who learns the value shape without resolving every branch.',
  ],
  ['const_with_type', 'Same reasoning as enum_with_type.'],
  [
    'enum_to_const',
    'This one is load-bearing, not stylistic. `specVersion` is a single-value `enum` ' +
      'and `kind` is a `const`, and tools/src/validator.ts maps the two keywords to ' +
      'different diagnostics — ERR_UNSUPPORTED_SPEC_VERSION and ERR_WRONG_KIND. ' +
      'Collapsing the enum would silently change a normative code.',
  ],
  [
    'top_level_examples',
    'Examples live in examples/, are validated by check:examples, and are whole ' +
      'documents rather than fragments inlined in the schema.',
  ],
  [
    'unnecessary_allof_wrapper',
    'The `allOf` branches carry if/then/else conditionals with `$comment`s explaining ' +
      'each. Elevating them would flatten the structure that makes the conditionals ' +
      'readable, for no change in what validates.',
  ],
])

function run(args: string[]): { status: number; output: string } {
  const result = spawnSync(CLI, args, { encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

function main(): void {
  if (!existsSync(CLI)) {
    console.log(`  · ${relativeToRepo(CLI)} not installed — skipped, not passed.`)
    console.log('    Run `bun install` in tools/ to enable it.')
    return
  }

  const failures = new Failures()
  let validated = 0

  for (const family of discoverFamilies()) {
    const paths = [...sourceModules(family)]
    if (existsSync(family.bundlePath)) paths.push(family.bundlePath)

    for (const path of paths) {
      const { status, output } = run(['metaschema', path])
      validated += 1
      if (status !== 0) {
        failures.add(
          `${relativeToRepo(path)}: rejected by an independent 2020-12 implementation — ` +
            output.trim(),
        )
      }
    }
  }

  // Advisory. A finding outside the excluded set is worth a reviewer's eye, but
  // a generic linter's opinion does not get to fail this repository's build.
  let advisories = 0
  for (const family of discoverFamilies()) {
    if (!existsSync(family.bundlePath)) continue
    const { output } = run(['lint', family.bundlePath])
    for (const line of output.split('\n')) {
      const rule = /\(([a-z_]+)\)\s*$/.exec(line)?.[1]
      if (rule === undefined || EXCLUDED_RULES.has(rule)) continue
      advisories += 1
      console.log(`  ! ${line.trim()}`)
    }
  }

  if (advisories > 0) {
    console.log(`\n  ${advisories} advisory finding(s) outside the reviewed exclusions.`)
  }

  failures.report(
    `${validated} schema(s) validated against the 2020-12 metaschema by an independent ` +
      `implementation; ${EXCLUDED_RULES.size} lint rule(s) excluded with reasons.`,
  )
}

if (import.meta.main) main()
