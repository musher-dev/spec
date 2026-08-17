/**
 * Structural agreement between two independent validators.
 *
 * Every executable claim this repository makes is currently decided by Ajv.
 * The conformance corpus proves the fixtures behave, `check:examples` proves
 * the examples validate — and both ask the same library. A schema that Ajv
 * happens to interpret differently from everyone else would pass every gate
 * here and fail in the CLI, the API, and every SDK, which is the one failure
 * this repository exists to prevent.
 *
 * So each structural subject is validated twice: once by Ajv, once by Blaze
 * through the Sourcemeta CLI, which is a separate implementation of 2020-12 in
 * a different language. Only the verdict is compared. Diagnostic text is not
 * normative (conformance/README.md), and Blaze does not emit Musher codes —
 * requiring it to would be requiring a second implementation to be the first.
 *
 * Skipped rather than failed when the CLI is absent, so a contributor without
 * it can still run `task check`. CI has it, and a skip is reported rather than
 * counted as a pass.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseDocument } from './document.ts'
import {
  discoverFamilies,
  Failures,
  type Family,
  isObject,
  type Json,
  REPO_ROOT,
  readJson,
  relativeToRepo,
} from './spec.ts'
import { compileFamily } from './validator.ts'

const CLI = join(REPO_ROOT, 'tools', 'node_modules', '.bin', 'jsonschema')

interface Subject {
  readonly path: string
  /** What the corpus says should happen at the structural phase. */
  readonly expectValid: boolean | null
}

/**
 * Instances per invocation.
 *
 * Batched because nearly all the cost is process startup and compiling a
 * 36 KiB schema: one instance takes ~1.5s and twenty take barely longer, so a
 * call per subject would put this check into the minutes and it would be turned
 * off. Chunked because the CLI mishandles a long argument list — past roughly
 * fifty paths it concatenates them into one non-existent filename and exits 6.
 * Twenty is comfortably inside that and still amortises the startup.
 */
const BATCH = 20

/** Ask Blaze about a family's subjects, returning the set it rejected. */
function blazeRejects(schema: string, instances: string[]): Set<string> {
  const rejected = new Set<string>()

  for (let start = 0; start < instances.length; start += BATCH) {
    const chunk = instances.slice(start, start + BATCH)
    const result = spawnSync(CLI, ['validate', schema, ...chunk], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

    if (result.status !== 0 && result.status !== 2) {
      throw new Error(`jsonschema validate exited ${result.status} — ${output.trim()}`)
    }

    let named = 0
    for (const line of output.split('\n')) {
      const path = /^fail:\s*(.+)$/.exec(line.trim())?.[1]
      if (path === undefined) continue
      rejected.add(path)
      named += 1
    }

    // A rejection the output does not name would silently become an agreement.
    // If the CLI's output shape ever changes, fail rather than pass everything.
    if (result.status === 2 && named === 0) {
      throw new Error(`jsonschema validate reported failure but named no file — ${output.trim()}`)
    }
  }

  return rejected
}

/**
 * Structural subjects: every example, plus every conformance case whose
 * document can be validated on its own.
 *
 * `parser` cases are excluded — they are about YAML this schema never sees, and
 * a document Blaze cannot parse says nothing about schema agreement. `semantic`
 * and `capability` cases are included only for their structural verdict, which
 * is "valid": a semantic fixture is structurally well-formed by construction,
 * which is what lets it reach the semantic phase at all.
 */
function subjectsFor(family: Family): Subject[] {
  const subjects: Subject[] = []

  if (existsSync(family.examplesDir)) {
    for (const name of readdirSync(family.examplesDir).sort()) {
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue
      subjects.push({ path: join(family.examplesDir, name), expectValid: true })
    }
  }

  const indexPath = join(family.conformanceDir, 'cases.json')
  if (!existsSync(indexPath)) return subjects

  const index = readJson(indexPath)
  const cases = isObject(index) && Array.isArray(index.cases) ? index.cases : []

  for (const entry of cases as Json[]) {
    if (!isObject(entry) || typeof entry.path !== 'string' || entry.phase === 'parser') continue
    const dir = join(family.conformanceDir, entry.path)
    const metadata = readJson(join(dir, 'metadata.json'))
    if (!isObject(metadata)) continue

    // A tree case's document sits inside `tree/`; a flat case is `case.yaml`.
    const document =
      typeof metadata.document === 'string'
        ? join(dir, 'tree', metadata.document)
        : join(dir, 'case.yaml')
    if (!existsSync(document)) continue

    // Only a `structural` case that is expected to fail is expected to be
    // structurally invalid. Everything else reaching this point is valid.
    const expectValid = !(entry.phase === 'structural' && metadata.expected === 'fail')
    subjects.push({ path: document, expectValid })
  }

  return subjects
}

function main(): void {
  if (!existsSync(CLI)) {
    console.log(`  · ${relativeToRepo(CLI)} not installed — parity skipped, not passed.`)
    console.log('    Run `bun install` in tools/ to enable it.')
    return
  }

  const failures = new Failures()
  let compared = 0
  let disagreements = 0

  for (const family of discoverFamilies()) {
    if (!existsSync(family.bundlePath)) continue
    const validate = compileFamily(family)

    // Only subjects the Musher parser accepts reach the schema at all, so the
    // batch Blaze is asked about is exactly the set Ajv is asked about.
    const subjects = subjectsFor(family).filter(
      (subject) => !('errors' in parseDocument(readFileSync(subject.path, 'utf8'))),
    )
    console.log(`  · ${family.name}/${family.major}: asking Blaze about ${subjects.length}…`)
    const rejected = blazeRejects(
      family.bundlePath,
      subjects.map((subject) => subject.path),
    )

    for (const subject of subjects) {
      const parsed = parseDocument(readFileSync(subject.path, 'utf8'))
      if ('errors' in parsed) continue

      const ajv = validate(parsed.value) as boolean
      const blaze = !rejected.has(resolve(subject.path))
      compared += 1

      if (ajv !== blaze) {
        disagreements += 1
        failures.add(
          `${relativeToRepo(subject.path)}: Ajv ${ajv ? 'accepts' : 'rejects'} it and Blaze ` +
            `${blaze ? 'accepts' : 'rejects'} it. Two validators reading one schema differently ` +
            'is a defect in the schema, not a preference between libraries.',
        )
        continue
      }

      // Agreement is not enough on its own: both could be wrong together, and
      // the corpus is what says which verdict is correct.
      if (subject.expectValid !== null && ajv !== subject.expectValid) {
        failures.add(
          `${relativeToRepo(subject.path)}: both validators ${ajv ? 'accept' : 'reject'} it, ` +
            `but the corpus declares it structurally ${subject.expectValid ? 'valid' : 'invalid'}.`,
        )
      }
    }
  }

  failures.report(
    `${compared} subject(s) agreed across Ajv and Blaze (${disagreements} disagreement(s)).`,
  )
}

if (import.meta.main) main()
