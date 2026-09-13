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
 *
 * The base bundle is built, not read: bundles are not tracked (docs/adr/0023).
 * Where the base commit carries a bundler with the `--stdout` contract, the
 * base is built by *that* bundler, so a tooling change that alters the bytes
 * shows up — and is reported apart from source changes. Otherwise the base's
 * sources are built by this branch's bundler through a git reader.
 *
 * A diagnostic code or requirement ID that left a family for a specification
 * the family depends on is reported as moved, not removed: the family still
 * applies the rule, so the move rejects nothing.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BindingsError, readBindings } from '../lib/bindings.ts'
import { listTreeFiles, readBlobAtRef } from '../lib/git.ts'
import {
  BUNDLER_ENTRY,
  discoverFamilies,
  type Family,
  familyPaths,
  isObject,
  type Json,
  REPO_ROOT,
  SPECIFICATIONS_ROOT,
  TOOLS_SOURCE_ROOT,
} from '../lib/layout.ts'
import { buildBundle, familyBundle } from '../schema/bundle.ts'
import { fsReader, gitReader, type ModuleReader } from '../schema/sources.ts'

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
  /** True where a name left this family for a specification it depends on. */
  readonly moved?: boolean
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

/**
 * What a requirement says, with its own identifier taken out: the line that
 * carries its anchor, less the anchor and any requirement ID in a code span.
 * Null when too little is left to call two statements the same rule.
 */
function statementOf(spec: string, id: string): string | null {
  const anchor = `<a id="${id}"></a>`
  const line = spec.split('\n').find((candidate) => candidate.includes(anchor))
  if (line === undefined) return null
  const text = line
    .replace(/<a id="[^"]*"><\/a>/g, '')
    .replace(/`[A-Z]+-[A-Z0-9]+-\d+`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.replace(/[\s|]/g, '').length >= 24 ? text : null
}

/** A specification a family reads at head: itself, or one it declares a dependency on. */
interface ReachableSpec {
  /** `<name>/<major>`. */
  readonly key: string
  readonly own: boolean
  readonly spec: string
  readonly conformanceDir: string
}

/**
 * The specifications a family's registry is drawn from at head: its own and
 * each normative dependency its §2 declares, as `check:conformance` resolves
 * them. A spec whose bindings do not parse reaches only itself; the
 * conformance run is what reports that.
 */
function reachableSpecs(family: Family, families: readonly Family[]): ReachableSpec[] {
  const read = (f: Family, own: boolean): ReachableSpec => ({
    key: `${f.name}/${f.major}`,
    own,
    spec: existsSync(f.specPath) ? readFileSync(f.specPath, 'utf8') : '',
    conformanceDir: f.conformanceDir,
  })
  const reach = [read(family, true)]
  if (family.role === 'core') return reach

  let bindings: ReturnType<typeof readBindings>
  try {
    bindings = readBindings(family)
  } catch (error) {
    if (error instanceof BindingsError) return reach
    throw error
  }
  for (const dependency of bindings?.dependencies ?? []) {
    const found = families.find((f) => f.name === dependency.family && f.major === dependency.line)
    if (found !== undefined) reach.push(read(found, false))
  }
  return reach
}

/** Requirement IDs each case of a family's corpus cited at a ref, keyed by case path. */
function citationsAt(repoRoot: string, ref: string, family: Family): Map<string, Set<string>> {
  const dir = familyPaths(family.name, family.major).conformance
  const cases = new Map<string, Set<string>>()
  for (const path of listTreeFiles(repoRoot, ref, dir)) {
    if (!path.endsWith('/metadata.json')) continue
    const cited = requirementsOfMetadata(readBlobAtRef(repoRoot, ref, path)?.toString('utf8'))
    cases.set(path.slice(dir.length + 1, -'/metadata.json'.length), cited)
  }
  return cases
}

function requirementsOfMetadata(text: string | undefined): Set<string> {
  if (text === undefined) return new Set()
  try {
    const doc = JSON.parse(text) as Json
    const list = isObject(doc) ? doc.requirements : undefined
    return new Set(
      Array.isArray(list) ? list.filter((r): r is string => typeof r === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

/**
 * Names that left a family's spec without leaving its registry.
 *
 * A diagnostic code is moved when a declared dependency declares it at head.
 * A requirement ID is moved when a dependency declares that same ID, or
 * renumbered when the family can no longer cite it but either the same
 * statement now carries another reachable ID, or the fixtures that pinned it —
 * the same case path, in the family's corpus or a dependency's — now pin one.
 * Both kinds of evidence are read from the tree, never from a list someone keeps.
 *
 * Maps each such name to the words the report uses for it.
 */
export function movedNames(
  family: Family,
  families: readonly Family[],
  base: string,
  repoRoot: string,
  removedCodes: ReadonlySet<string>,
  removedRequirements: ReadonlySet<string>,
  specBefore: string,
): Map<string, string> {
  const moved = new Map<string, string>()
  if (removedCodes.size === 0 && removedRequirements.size === 0) return moved
  const reach = reachableSpecs(family, families)

  for (const code of removedCodes) {
    const home = reach.find((spec) => !spec.own && codesIn(spec.spec).has(code))
    if (home !== undefined) moved.set(code, `moved to ${home.key}`)
  }

  const reachable = new Map<string, ReachableSpec>()
  for (const spec of reach) {
    for (const id of requirementsIn(spec.spec)) if (!reachable.has(id)) reachable.set(id, spec)
  }
  const describe = (id: string, evidence: string): string => {
    const home = reachable.get(id) as ReachableSpec
    return home.own
      ? `renumbered \`${id}\` (${evidence})`
      : `moved to ${home.key} as \`${id}\` (${evidence})`
  }

  const citedBefore = [...removedRequirements].some((id) => statementOf(specBefore, id) === null)
    ? citationsAt(repoRoot, base, family)
    : null
  let casesBefore = citedBefore

  for (const id of removedRequirements) {
    const home = reachable.get(id)
    if (home !== undefined && !home.own) {
      moved.set(id, `moved to ${home.key}`)
      continue
    }

    const statement = statementOf(specBefore, id)
    const sameStatement =
      statement === null
        ? []
        : [...reachable.keys()].filter(
            (candidate) =>
              !requirementsIn(specBefore).has(candidate) &&
              statementOf((reachable.get(candidate) as ReachableSpec).spec, candidate) ===
                statement,
          )
    if (sameStatement.length > 0) {
      moved.set(id, sameStatement.map((c) => describe(c, 'same statement')).join('; '))
      continue
    }

    casesBefore ??= citationsAt(repoRoot, base, family)
    const pinnedNow = new Set<string>()
    for (const [casePath, cited] of casesBefore) {
      if (!cited.has(id)) continue
      for (const spec of reach) {
        const metadata = join(spec.conformanceDir, ...casePath.split('/'), 'metadata.json')
        if (!existsSync(metadata)) continue
        for (const now of requirementsOfMetadata(readFileSync(metadata, 'utf8'))) {
          if (!cited.has(now) && reachable.has(now)) pinnedNow.add(now)
        }
      }
    }
    if (pinnedNow.size > 0) {
      moved.set(
        id,
        [...pinnedNow]
          .sort()
          .map((c) => describe(c, 'its cases now cite it'))
          .join('; '),
      )
    }
  }
  return moved
}

function diffNamed(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  noun: string,
  moved: ReadonlyMap<string, string>,
): Change[] {
  const changes: Change[] = []
  for (const name of [...after].filter((n) => !before.has(n)).sort()) {
    changes.push({ narrowing: false, line: `\`${name}\` — ${noun} added` })
  }
  for (const name of [...before].filter((n) => !after.has(n)).sort()) {
    const where = moved.get(name)
    changes.push(
      where === undefined
        ? { narrowing: true, line: `\`${name}\` — ${noun} **removed**` }
        : { narrowing: false, moved: true, line: `\`${name}\` — ${noun} ${where}` },
    )
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

/** The diagnostics and requirements a family's prose adds, removes, and moves. */
function namedChanges(
  family: Family,
  families: readonly Family[],
  base: string,
  repoRoot: string,
  specBefore: string,
): { codes: Change[]; requirements: Change[] } {
  const specAfter = existsSync(family.specPath) ? readFileSync(family.specPath, 'utf8') : ''
  const codesBefore = new Set(codesIn(specBefore).keys())
  const codesAfter = new Set(codesIn(specAfter).keys())
  const requirementsBefore = requirementsIn(specBefore)
  const requirementsAfter = requirementsIn(specAfter)
  const moved = movedNames(
    family,
    families,
    base,
    repoRoot,
    new Set([...codesBefore].filter((c) => !codesAfter.has(c))),
    new Set([...requirementsBefore].filter((r) => !requirementsAfter.has(r))),
    specBefore,
  )
  return {
    codes: diffNamed(codesBefore, codesAfter, 'diagnostic', moved),
    requirements: diffNamed(requirementsBefore, requirementsAfter, 'requirement', moved),
  }
}

export interface FamilyReport {
  readonly lines: string[]
  /** Changes that can reject a document that validates today. */
  readonly narrowing: number
  /** Codes and requirement IDs that moved to a dependency, or were renumbered. */
  readonly moved: number
  /** The base bundle, or null for a new family or a schema-less one. */
  readonly before: string | null
  /** The head bundle, or null for a schema-less family. */
  readonly after: string | null
}

export interface ReportOptions {
  /** Every family at head. Defaults to discovering them under `repoRoot`. */
  readonly families?: readonly Family[]
  /** Build the base bundle. Defaults to this bundler over the base's sources. */
  readonly baseBundle?: (family: Family) => string | null
}

function tally(changes: readonly Change[]): { narrowing: number; moved: number } {
  return {
    narrowing: changes.filter((c) => c.narrowing).length,
    moved: changes.filter((c) => c.moved === true).length,
  }
}

/**
 * A family with no schema — core — has only prose to compare: its diagnostics
 * and its requirement IDs. It is headed as affecting every family, because
 * every kind family applies core in full, so a change here is a change to each
 * of them even though no bundle moves.
 */
function reportProseOnly(
  family: Family,
  families: readonly Family[],
  base: string,
  repoRoot: string,
): FamilyReport {
  const heading = `### ${family.name}/${family.major} — affects every family`
  const beforeSpec = readBlobAtRef(repoRoot, base, familyPaths(family.name, family.major).spec)
  const empty = { narrowing: 0, moved: 0, before: null, after: null }
  if (beforeSpec === null) {
    return { lines: [heading, '', '_New family — nothing to compare._', ''], ...empty }
  }

  const named = namedChanges(family, families, base, repoRoot, beforeSpec.toString('utf8'))
  const all = [...named.codes, ...named.requirements]
  if (all.length === 0) return { lines: [], ...empty }

  const lines = [
    heading,
    '',
    '_Core ships no schema. Every kind family applies it in full, so each change below ' +
      'reaches every document of every family._',
    '',
  ]
  lines.push(...section('Diagnostics', named.codes))
  lines.push(...section('Requirements', named.requirements))

  return { lines, ...tally(all), before: null, after: null }
}

/** Whether the schema modules differ between a ref and the working tree. */
function sourcesChanged(repoRoot: string, base: string, family: Family): boolean {
  const src = familyPaths(family.name, family.major).src
  const snapshot = (reader: ModuleReader): string[] =>
    reader
      .list(src)
      .sort()
      .map((name) => `${name}\0${reader.read(`${src}/${name}`)?.toString('base64') ?? ''}`)
  const before = snapshot(gitReader(repoRoot, base))
  const after = snapshot(fsReader(repoRoot))
  return before.length !== after.length || before.some((entry, i) => entry !== after[i])
}

export function reportFamily(
  family: Family,
  base: string,
  repoRoot: string = REPO_ROOT,
  options: ReportOptions = {},
): FamilyReport {
  const families = options.families ?? discoverFamilies(repoRoot)
  if (family.role === 'core') return reportProseOnly(family, families, base, repoRoot)

  const buildBase =
    options.baseBundle ?? ((f: Family) => buildBundle(f, { reader: gitReader(repoRoot, base) }))
  const before = buildBase(family)
  const after = familyBundle(family)
  if (before === null) {
    return {
      lines: [`### ${family.name}/${family.major}`, '', '_New family — nothing to compare._', ''],
      narrowing: 0,
      moved: 0,
      before: null,
      after,
    }
  }

  const fieldChanges = diffFields(
    fieldMap(JSON.parse(before) as Json),
    fieldMap(JSON.parse(after ?? '{}') as Json),
  )

  const specBefore =
    readBlobAtRef(repoRoot, base, familyPaths(family.name, family.major).spec)?.toString('utf8') ??
    ''
  const named = namedChanges(family, families, base, repoRoot, specBefore)

  // Same sources, different bytes: the bundler changed what it emits. Nothing a
  // reviewer reads under `schemas/src` shows it, and every consumer downloads it.
  const toolingOnly = before !== after && !sourcesChanged(repoRoot, base, family)

  const all = [...fieldChanges, ...named.codes, ...named.requirements]
  if (all.length === 0 && !toolingOnly) return { lines: [], narrowing: 0, moved: 0, before, after }

  const lines = [`### ${family.name}/${family.major}`, '']
  if (toolingOnly) {
    lines.push(
      '#### Bundle bytes',
      '',
      '- **Tooling-only change.** No module under `schemas/src` changed, but the bundle built ' +
        'from them did: the bundler now emits different bytes for the same sources. ' +
        'Run with `--diff` to see them.',
      '',
    )
  }
  lines.push(...section('Fields and constraints', fieldChanges))
  lines.push(...section('Diagnostics', named.codes))
  lines.push(...section('Requirements', named.requirements))

  return { lines, ...tally(all), before, after }
}

/**
 * Build base bundles with the base commit's own bundler, when it has one that
 * honours `--stdout`. Null otherwise — an older base, or one this cannot
 * extract — and the caller falls back to this branch's bundler.
 */
function baseTooling(
  repoRoot: string,
  base: string,
): { build: (family: Family) => string | null; cleanup: () => void } | null {
  const entry = readBlobAtRef(repoRoot, base, BUNDLER_ENTRY)
  if (entry === null || !entry.toString('utf8').includes("'--stdout'")) return null

  const dir = mkdtempSync(join(tmpdir(), 'musher-changes-'))
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true })
  const archive = spawnSync(
    'git',
    ['archive', '--format=tar', base, '--', TOOLS_SOURCE_ROOT, SPECIFICATIONS_ROOT],
    { cwd: repoRoot, maxBuffer: 512 * 1024 * 1024 },
  )
  const extracted =
    archive.status === 0 &&
    spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout }).status === 0
  if (!extracted) {
    cleanup()
    return null
  }

  return {
    build(family) {
      const result = spawnSync(
        process.execPath,
        [join(dir, ...BUNDLER_ENTRY.split('/')), '--stdout', `${family.name}/${family.major}`],
        { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      )
      if (result.status === 0) return result.stdout
      // Exit 1 is the contract's "no schema modules authored" — a new family.
      if (result.status === 1) return null
      throw new Error(
        `the bundler at ${base} failed for ${family.name}/${family.major} — ${result.stderr.trim()}`,
      )
    },
    cleanup,
  }
}

/** A unified diff of two texts, as `git diff --no-index` writes it. Empty when equal. */
export function unifiedDiff(name: string, before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'musher-diff-'))
  try {
    for (const [side, text] of [
      ['base', before],
      ['head', after],
    ] as const) {
      mkdirSync(join(dir, side))
      writeFileSync(join(dir, side, name), text, 'utf8')
    }
    const result = spawnSync(
      'git',
      ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', `base/${name}`, `head/${name}`],
      {
        cwd: dir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
      },
    )
    if (result.status === 0) return ''
    if (result.status !== 1) throw new Error(`git diff --no-index failed — ${result.stderr.trim()}`)
    return result.stdout
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const showDiff = args.includes('--diff')
  const base = args.find((arg) => !arg.startsWith('--')) ?? 'origin/main'

  const tooling = baseTooling(REPO_ROOT, base)
  const families = discoverFamilies()
  const body: string[] = []
  const diffs: string[] = []
  let narrowing = 0
  let moved = 0
  try {
    for (const family of families) {
      const report = reportFamily(family, base, REPO_ROOT, {
        families,
        ...(tooling === null ? {} : { baseBundle: tooling.build }),
      })
      body.push(...report.lines)
      narrowing += report.narrowing
      moved += report.moved
      if (showDiff && report.before !== null && report.after !== null) {
        const diff = unifiedDiff(`${family.name}.schema.json`, report.before, report.after)
        if (diff !== '') {
          diffs.push(
            `<details><summary><code>${family.name}/${family.major}</code> bundle diff</summary>`,
            '',
            '````diff',
            diff.trimEnd(),
            '````',
            '',
            '</details>',
            '',
          )
        }
      }
    }
  } finally {
    tooling?.cleanup()
  }

  if (body.length === 0 && diffs.length === 0) {
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
  if (moved > 0) {
    console.log(
      `> ${moved} diagnostic code(s) and requirement ID(s) left a family for a specification ` +
        'it depends on, or were renumbered. A move rejects nothing: the family still applies ' +
        'the rule, and a citation of the old ID needs updating.\n',
    )
  }
  console.log(body.join('\n'))
  if (diffs.length > 0) {
    console.log('## Bundle diff\n')
    console.log(diffs.join('\n'))
  }
}

if (import.meta.main) main()
