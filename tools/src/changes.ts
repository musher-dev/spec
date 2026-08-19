/**
 * What a pull request does to the published contract, in a form a reviewer
 * reads instead of a diff.
 *
 * `check:compat` is the gate: it replays every document a released version
 * accepted against the candidate schema, and a rejection fails the build. It is
 * also, deliberately, silent about everything else — a widened enum, a new
 * optional field, a changed default and a renamed diagnostic all pass it, and
 * all four are things a reviewer of a *specification* wants named.
 *
 * A JSON diff of the bundle is not that. It reports `$defs` reordering, comment
 * rewording, and one changed `pattern` at the same volume, in a file where the
 * interesting change is four lines out of nine hundred.
 *
 * So this walks both bundles into a map of field paths and the constraints at
 * each, diffs those, and classifies what it finds by whether it can reject a
 * document that used to validate. It aids review; it replaces neither
 * `check:compat` nor the conformance corpus.
 */
import { existsSync, readFileSync } from 'node:fs'
import { readBlobAtRef } from './git.ts'
import {
  discoverFamilies,
  type Family,
  isObject,
  type Json,
  REPO_ROOT,
  relativeToRepo,
} from './spec.ts'

/** Constraints worth naming when they change. Anything else is wording. */
const CONSTRAINTS = [
  'type',
  'enum',
  'const',
  'pattern',
  'format',
  'default',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
] as const

interface FieldFacts {
  readonly required: boolean
  readonly facts: Record<string, Json>
}

type FieldMap = Map<string, FieldFacts>

function deref(
  bundle: Json,
  schema: Json,
  seen: ReadonlySet<string>,
): { schema: Json; seen: Set<string> } {
  const visited = new Set(seen)
  let here = schema
  for (let hops = 0; hops < 32; hops += 1) {
    if (!isObject(here)) break
    const ref = here.$ref
    if (typeof ref !== 'string' || !ref.startsWith('#/$defs/')) break
    const name = ref.slice('#/$defs/'.length)
    // A recursive definition would otherwise walk forever. Stopping is right:
    // the second occurrence of a shape says nothing the first did not.
    if (visited.has(name)) return { schema: {}, seen: visited }
    visited.add(name)
    const defs = isObject(bundle) ? bundle.$defs : undefined
    const target = isObject(defs) ? defs[name] : undefined
    if (target === undefined) break
    here = target
  }
  return { schema: here, seen: visited }
}

function factsOf(schema: Json): Record<string, Json> {
  const facts: Record<string, Json> = {}
  if (!isObject(schema)) return facts
  for (const key of CONSTRAINTS) {
    if (key in schema) facts[key] = schema[key] as Json
  }
  return facts
}

/**
 * Every field path the schema defines, with the constraints at each.
 *
 * A path is written the way an author reads a document — `spec.workload.command`,
 * `spec.workload.endpoints.*.containerPort`, `spec.workload.envVars[].key` —
 * because a reviewer is deciding whether a *document* still validates, not
 * where a keyword sits in a bundle.
 */
function fieldMap(bundle: Json): FieldMap {
  const out: FieldMap = new Map()

  const walk = (schema: Json, path: string, seen: ReadonlySet<string>, depth: number): void => {
    if (depth > 24) return
    const { schema: here, seen: nowSeen } = deref(bundle, schema, seen)
    if (!isObject(here)) return

    // A nullable field is `anyOf: [{…}, {"type": "null"}]`, and the branch that
    // is not null is the one carrying the shape. Two live branches are a real
    // union; both are walked, and a field defined in either is defined.
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branches = here[key]
      if (Array.isArray(branches)) {
        for (const branch of branches) walk(branch, path, nowSeen, depth + 1)
      }
    }
    for (const key of ['then', 'else'] as const) {
      if (here[key] !== undefined) walk(here[key] as Json, path, nowSeen, depth + 1)
    }

    const required = new Set(
      Array.isArray(here.required)
        ? here.required.filter((r): r is string => typeof r === 'string')
        : [],
    )

    if (isObject(here.properties)) {
      for (const [name, child] of Object.entries(here.properties)) {
        const childPath = path === '' ? name : `${path}.${name}`
        const { schema: resolved } = deref(bundle, child as Json, nowSeen)
        const existing = out.get(childPath)
        out.set(childPath, {
          // A field required on any branch that defines it is reported as
          // required; `if/then` makes several branches define the same field.
          required: (existing?.required ?? false) || required.has(name),
          facts: { ...(existing?.facts ?? {}), ...factsOf(resolved) },
        })
        walk(child as Json, childPath, nowSeen, depth + 1)
      }
    }

    if (isObject(here.additionalProperties)) {
      walk(here.additionalProperties, `${path}.*`, nowSeen, depth + 1)
    }
    if (here.items !== undefined) {
      walk(here.items as Json, `${path}[]`, nowSeen, depth + 1)
    }
  }

  walk(bundle, '', new Set(), 0)
  return out
}

interface Change {
  /** True where the change can reject a document that used to validate. */
  readonly narrowing: boolean
  readonly line: string
}

function describe(value: Json | undefined): string {
  return value === undefined ? '—' : JSON.stringify(value)
}

function diffFields(before: FieldMap, after: FieldMap): Change[] {
  const changes: Change[] = []
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort()

  for (const path of paths) {
    const was = before.get(path)
    const now = after.get(path)

    if (was === undefined && now !== undefined) {
      changes.push({
        narrowing: now.required,
        line: `\`${path}\` — **added**${now.required ? ', and it is REQUIRED' : ' (optional)'}`,
      })
      continue
    }
    if (was !== undefined && now === undefined) {
      changes.push({ narrowing: true, line: `\`${path}\` — **removed**` })
      continue
    }
    if (was === undefined || now === undefined) continue

    if (!was.required && now.required) {
      changes.push({ narrowing: true, line: `\`${path}\` — became **REQUIRED**` })
    }
    if (was.required && !now.required) {
      changes.push({ narrowing: false, line: `\`${path}\` — became optional` })
    }

    for (const key of CONSTRAINTS) {
      const a = was.facts[key]
      const b = now.facts[key]
      if (JSON.stringify(a) === JSON.stringify(b)) continue

      if (key === 'enum' && Array.isArray(a) && Array.isArray(b)) {
        const removed = a.filter((v) => !b.some((w) => JSON.stringify(w) === JSON.stringify(v)))
        const added = b.filter((v) => !a.some((w) => JSON.stringify(w) === JSON.stringify(v)))
        if (removed.length > 0) {
          changes.push({
            narrowing: true,
            line: `\`${path}\` — enum **removed** ${removed.map((v) => `\`${String(v)}\``).join(', ')}`,
          })
        }
        if (added.length > 0) {
          changes.push({
            narrowing: false,
            line: `\`${path}\` — enum added ${added.map((v) => `\`${String(v)}\``).join(', ')}`,
          })
        }
        continue
      }

      // Adding a bound or a pattern where there was none can only reject more.
      // Loosening one is judged by a reviewer; this says which direction it is.
      const narrowing = a === undefined || key === 'pattern' || key === 'type' || key === 'format'
      const label = key === 'default' ? 'default' : key
      changes.push({
        narrowing: key === 'default' ? false : narrowing,
        line: `\`${path}\` — ${label} ${describe(a)} → ${describe(b)}`,
      })
    }
  }

  return changes
}

/** `| \`ERR_X\` | \`semantic\` |` — the registry tables, and only those. */
const DIAGNOSTIC_ROW = /^\|\s*`(ERR_[A-Z0-9_]+)`\s*\|\s*`([a-z]+)`\s*\|/
const REQUIREMENT_ANCHOR = /<a id="([A-Z]+-[A-Z0-9]+-\d+)"><\/a>/g

function codesIn(spec: string): Map<string, string> {
  const codes = new Map<string, string>()
  for (const line of spec.split('\n')) {
    const match = DIAGNOSTIC_ROW.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) codes.set(match[1], match[2])
  }
  return codes
}

function requirementsIn(spec: string): Set<string> {
  return new Set([...spec.matchAll(REQUIREMENT_ANCHOR)].map((m) => m[1] as string))
}

function diffNamed(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  noun: string,
): Change[] {
  const changes: Change[] = []
  for (const name of [...after].filter((n) => !before.has(n)).sort()) {
    changes.push({ narrowing: false, line: `\`${name}\` — ${noun} added` })
  }
  for (const name of [...before].filter((n) => !after.has(n)).sort()) {
    changes.push({ narrowing: true, line: `\`${name}\` — ${noun} **removed**` })
  }
  return changes
}

function section(title: string, changes: Change[]): string[] {
  if (changes.length === 0) return []
  const lines = [`#### ${title}`, '']
  for (const change of changes) lines.push(`- ${change.line}`)
  lines.push('')
  return lines
}

function reportFamily(family: Family, base: string): { lines: string[]; narrowing: number } {
  const bundleRel = relativeToRepo(family.bundlePath)
  const specRel = relativeToRepo(family.specPath)

  const beforeBundle = readBlobAtRef(REPO_ROOT, base, bundleRel)
  const beforeSpec = readBlobAtRef(REPO_ROOT, base, specRel)
  if (beforeBundle === null) {
    return {
      lines: [`### ${family.name}/${family.major}`, '', '_New family — nothing to compare._', ''],
      narrowing: 0,
    }
  }

  const before = fieldMap(JSON.parse(beforeBundle.toString('utf8')) as Json)
  const after = fieldMap(JSON.parse(readFileSync(family.bundlePath, 'utf8')) as Json)

  const fieldChanges = diffFields(before, after)

  const specBefore = beforeSpec?.toString('utf8') ?? ''
  const specAfter = existsSync(family.specPath) ? readFileSync(family.specPath, 'utf8') : ''
  const codeChanges = diffNamed(
    new Set(codesIn(specBefore).keys()),
    new Set(codesIn(specAfter).keys()),
    'diagnostic',
  )
  const requirementChanges = diffNamed(
    requirementsIn(specBefore),
    requirementsIn(specAfter),
    'requirement',
  )

  const all = [...fieldChanges, ...codeChanges, ...requirementChanges]
  if (all.length === 0) return { lines: [], narrowing: 0 }

  const lines = [`### ${family.name}/${family.major}`, '']
  lines.push(...section('Fields and constraints', fieldChanges))
  lines.push(...section('Diagnostics', codeChanges))
  lines.push(...section('Requirements', requirementChanges))

  return { lines, narrowing: all.filter((c) => c.narrowing).length }
}

function main(): void {
  const base = process.argv[2] ?? 'origin/main'

  const body: string[] = []
  let narrowing = 0
  for (const family of discoverFamilies()) {
    const report = reportFamily(family, base)
    body.push(...report.lines)
    narrowing += report.narrowing
  }

  if (body.length === 0) {
    console.log(`No contract changes against \`${base}\`.`)
    return
  }

  console.log('## Contract changes\n')
  console.log(`Against \`${base}\`. This aids review; \`check:compat\` remains the gate.\n`)
  if (narrowing > 0) {
    console.log(
      `> **${narrowing} change(s) can reject a document that validates today.** ` +
        'That is a breaking change: it needs maintainer approval and a `BREAKING CHANGE:` ' +
        'trailer, and — once a family has been tagged — a new `v<N>` directory. While a ' +
        'family is unpublished, ADR 0005 §1 waives the directory and the migration note ' +
        'and nothing else.\n',
    )
  } else {
    console.log('> No change here rejects a document that validates today.\n')
  }
  console.log(body.join('\n'))
}

if (import.meta.main) main()
