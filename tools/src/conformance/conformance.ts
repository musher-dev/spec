/**
 * Execute the language-neutral conformance corpus.
 *
 * This runner exists to keep the fixtures honest inside this repository. It is
 * NOT the normative runner — there deliberately is none. Downstream
 * implementations write their own adapter over the same data, which is what
 * makes cross-language parity provable rather than asserted.
 *
 * Two kinds of check live here. Executing a case needs a phase this repository
 * implements; validating that a case is *well-formed* — that it cites a clause
 * that exists and declares codes the prose actually defines — does not. The
 * second kind runs for every case, including the ones the first kind skips,
 * because a `semantic` fixture would otherwise be checked by nothing at all.
 *
 * Two kinds of corpus live in the tree. A kind family's corpus runs through the
 * whole pipeline against that family's bundle. The core corpus runs through the
 * parser alone, with no bundle and no dispatch on `kind` (core v1 §8.1).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { BindingsError, readBindings } from '../lib/bindings.ts'
import {
  CORE_FAMILY,
  canonicalJson,
  discoverFamilies,
  Failures,
  type Family,
  inRepo,
  isObject,
  type Json,
  REPO_ROOT,
  readJson,
  relativeToRepo,
} from '../lib/layout.ts'
import { enclosingSections, type Outline, REQUIREMENT_ID, readOutline } from '../lib/outline.ts'
import { familyBundle } from '../schema/bundle.ts'
import { effectiveValue, pointerSegments } from '../validation/effective.ts'
import {
  type Diagnostic,
  type Phase,
  parseDocument,
  validateDocument,
} from '../validation/validator.ts'

interface CaseIndexEntry {
  readonly id: string
  readonly phase: Phase
  readonly path: string
}

export interface CaseMetadata {
  readonly id: string
  readonly phase: Phase
  readonly expected: 'pass' | 'fail'
  readonly clause?: string
  /**
   * Stable requirement identifiers this case exercises, e.g. `CORE-ENV-002`.
   *
   * `clause` names a section; a section states several rules. Thirteen cases
   * cite core's `#envelope`, which covers `specVersion`, `kind`, unknown fields,
   * and an unsupported version — so the citation says where to look and not
   * what is being pinned. An ID says which rule, and survives a heading being
   * renamed.
   */
  readonly requirements?: string[]
  readonly summary?: string
  /**
   * Effective values this case pins, keyed by JSON Pointer (ADR 0008).
   *
   * `expected: "pass"` only, and never in the core corpus. A validator answers
   * whether a document is accepted; it does not answer what the document
   * *means* where it says nothing, and two implementations that agree on the
   * first can still disagree on the second. This map is where the corpus says
   * so.
   */
  readonly effective?: Record<string, Json>
  /**
   * Tree cases only (ADR 0002). Path of the document under test, relative to
   * `tree/`. Its containing directory is the item root.
   */
  readonly document?: string
  /**
   * Tree cases only. Link path (relative to `tree/`) to link target, verbatim.
   * Materialised at run time rather than committed — see ADR 0002 §3.
   */
  readonly symlinks?: Record<string, string>
}

interface DeclaredDiagnostic {
  readonly code: string
  readonly path: string
}

const PHASES: readonly Phase[] = ['parser', 'structural', 'semantic', 'capability']

/**
 * `capability` is the one phase this repository cannot run: it needs an account,
 * a region and a quota, which is a server. The other three are executed here —
 * see ADR 0002 §5 for why running them is not this repository publishing a
 * reference validator.
 */
const IMPLEMENTED_PHASES = new Set<Phase>(['parser', 'structural', 'semantic'])

/**
 * The profiles docs/conformance.md defines, cumulative and in order.
 *
 * Naming them here rather than only in prose is what stops the two drifting: if
 * a phase is added to `IMPLEMENTED_PHASES`, the profile this runner reports
 * changes with it, and if a profile's phase list is edited the runner's own
 * claim moves. A profile nobody computes is a profile nobody checks.
 */
const PROFILES: readonly { readonly name: string; readonly phases: readonly Phase[] }[] = [
  { name: 'parser', phases: ['parser'] },
  { name: 'structural', phases: ['parser', 'structural'] },
  { name: 'offline', phases: ['parser', 'structural', 'semantic'] },
  { name: 'platform', phases: ['parser', 'structural', 'semantic', 'capability'] },
]

/** The highest profile a given set of implemented phases satisfies. */
export function profileFor(implemented: ReadonlySet<Phase>): string | null {
  let highest: string | null = null
  for (const profile of PROFILES) {
    if (profile.phases.every((phase) => implemented.has(phase))) highest = profile.name
  }
  return highest
}

/** A row of a `| Code | Phase | Meaning |` table in a spec.md. */
const DIAGNOSTIC_ROW = /^\|\s*`(ERR_[A-Z0-9_]+)`\s*\|\s*`([a-z]+)`\s*\|/
/** A stable heading anchor, `## <a id="envelope"></a>2. Document envelope`. */
const SPEC_ANCHOR = /<a id="([^"]+)"><\/a>/g
/**
 * A diagnostic code named anywhere in the prose, inside backticks.
 *
 * `DIAGNOSTIC_ROW` is anchored to `^|`, so it sees only the registry tables. A
 * code named in a sentence is the same promise to an implementer and was
 * matched by nothing — see `checkProseCodes`.
 */
const PROSE_CODE = /`(ERR_[A-Z0-9_]+)`/g

interface SpecIndex {
  /** Diagnostic code to the phase the prose assigns it. */
  readonly codes: ReadonlyMap<string, Phase>
  readonly anchors: ReadonlySet<string>
  /** Sections and the section each requirement is declared under. */
  readonly outline: Outline
}

const specIndexCache = new Map<string, SpecIndex | undefined>()

/** Index one spec.md, or `undefined` when there is no such file. */
function specIndex(path: string): SpecIndex | undefined {
  const cached = specIndexCache.get(path)
  if (cached !== undefined || specIndexCache.has(path)) return cached

  let index: SpecIndex | undefined
  if (existsSync(path)) {
    const source = readFileSync(path, 'utf8')
    const codes = new Map<string, Phase>()
    for (const line of source.split('\n')) {
      const row = DIAGNOSTIC_ROW.exec(line)
      if (row?.[1] !== undefined && row[2] !== undefined) codes.set(row[1], row[2] as Phase)
    }
    const anchors = new Set<string>()
    for (const match of source.matchAll(SPEC_ANCHOR)) {
      if (match[1] !== undefined) anchors.add(match[1])
    }
    index = { codes, anchors, outline: readOutline(source) }
  }
  specIndexCache.set(path, index)
  return index
}

/** The codes one spec.md's diagnostics table declares; empty when it has none. */
function codesOf(specPath: string): ReadonlyMap<string, Phase> {
  return specIndex(specPath)?.codes ?? new Map()
}

/**
 * Every requirement ID declared across the specifications, mapped to the
 * document that declares it.
 *
 * IDs are global rather than per-family on purpose: a component fixture cites
 * core's envelope requirements, and the prefix already says which document to
 * open. Two documents declaring the same ID is a defect — the same name would
 * mean two rules.
 */
function requirementIndex(families: readonly Family[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const family of families) {
    const anchors = specIndex(family.specPath)?.anchors ?? new Set<string>()
    for (const anchor of anchors) {
      if (!REQUIREMENT_ID.test(anchor)) continue
      const previous = index.get(anchor)
      if (previous !== undefined && previous !== family.specPath) {
        throw new Error(
          `${anchor} is declared in both ${relativeToRepo(previous)} and ` +
            `${relativeToRepo(family.specPath)} — one ID names one rule`,
        )
      }
      index.set(anchor, family.specPath)
    }
  }
  return index
}

/** What a corpus may draw on: the codes it may declare, and the specs it may cite. */
export interface Reach {
  /** Every diagnostic code a case in this corpus may declare, with its phase. */
  readonly registry: ReadonlyMap<string, Phase>
  /**
   * Absolute paths of every spec.md a case in this corpus may cite: the
   * family's own, core's, and each normative dependency its §2 declares.
   */
  readonly specs: ReadonlySet<string>
}

/** Everything the per-case checks read, resolved once for the whole tree. */
export interface Context {
  readonly repoRoot: string
  readonly families: readonly Family[]
  /** Requirement ID to the absolute path of the spec.md declaring it. */
  readonly requirements: ReadonlyMap<string, string>
  /** Keyed `<name>/<major>`. */
  readonly reach: ReadonlyMap<string, Reach>
}

function familyKey(family: { readonly name: string; readonly major: string }): string {
  return `${family.name}/${family.major}`
}

/**
 * Resolve what one family's corpus may draw on.
 *
 * Core's registry is core §7 alone: it depends on nothing. A kind family's is
 * its own table, core's, and the table of each family its §2 "Normative
 * dependencies" table names — blueprint lists component, which is why a
 * blueprint fixture may declare `ERR_UNKNOWN_ENUM_MEMBER` and a listing one may
 * not. A family that names no dependencies has no route to core's codes, so it
 * fails here rather than failing every case one at a time.
 *
 * Core §7 also says a family table adds codes and MUST NOT declare a core code
 * again: two rows for one code can carry two meanings, which is exactly how
 * blueprint and listing came to disagree on `ERR_VERSION_MISMATCH`.
 */
export function resolveReach(
  family: Family,
  families: readonly Family[],
  failures: Failures,
): Reach {
  const own = codesOf(family.specPath)
  const ownOnly: Reach = { registry: own, specs: new Set([family.specPath]) }
  if (family.role === 'core') return ownOnly

  const where = `${familyKey(family)} spec.md §2`
  let bindings: ReturnType<typeof readBindings>
  try {
    bindings = readBindings(family)
  } catch (error) {
    if (!(error instanceof BindingsError)) throw error
    failures.add(`${error.message}. Its diagnostic registry cannot be resolved.`)
    return ownOnly
  }
  if (bindings === null) {
    failures.add(
      `${where} declares no normative dependencies. A kind family is built on core and ` +
        'MUST list it (core v1 §1.1), or no core diagnostic code is reachable from its corpus.',
    )
    return ownOnly
  }

  const dependencies: Family[] = []
  for (const dependency of bindings.dependencies) {
    const found = families.find((f) => f.name === dependency.family && f.major === dependency.line)
    if (found === undefined) {
      failures.add(
        `${where} depends on ${dependency.family} ${dependency.line}, which is not a family ` +
          'version in this tree',
      )
      continue
    }
    dependencies.push(found)
  }

  const core = dependencies.find((d) => d.role === 'core')
  if (!bindings.dependencies.some((d) => d.family === CORE_FAMILY)) {
    failures.add(
      `${where} does not list core among its normative dependencies. Every kind family is ` +
        'built on core and MUST declare the core line it applies (core v1 §1.1).',
    )
  }

  if (core !== undefined) {
    const coreCodes = codesOf(core.specPath)
    for (const code of own.keys()) {
      if (!coreCodes.has(code)) continue
      failures.add(
        `${relativeToRepo(family.specPath)}: ${code} is declared in ` +
          `${relativeToRepo(core.specPath)} §7 and again in this family's diagnostics table. ` +
          'A family adds codes to core’s and MUST NOT declare one of them again (core v1 §7).',
      )
    }
  }

  // Core first, then the other dependencies in table order, then the family's
  // own rows — so a re-declaration, already reported above, cannot also
  // silently change the phase a case is checked against.
  const ordered = [
    ...dependencies.filter((d) => d.role === 'core'),
    ...dependencies.filter((d) => d.role !== 'core'),
  ]
  const registry = new Map<string, Phase>()
  for (const dependency of ordered) {
    for (const [code, phase] of codesOf(dependency.specPath)) registry.set(code, phase)
  }
  for (const [code, phase] of own) if (!registry.has(code)) registry.set(code, phase)

  return {
    registry,
    specs: new Set([family.specPath, ...dependencies.map((d) => d.specPath)]),
  }
}

/**
 * Resolve every family's reach and the global requirement index.
 *
 * Resolution problems — a kind family with no core dependency, a re-declared
 * core code — are reported once here, not once per case.
 */
export function loadContext(repoRoot: string, failures: Failures): Context {
  const families = discoverFamilies(repoRoot)
  const reach = new Map<string, Reach>()
  for (const family of families)
    reach.set(familyKey(family), resolveReach(family, families, failures))
  return { repoRoot, families, requirements: requirementIndex(families), reach }
}

function reachOf(context: Context, family: Family): Reach {
  return (
    context.reach.get(familyKey(family)) ?? {
      registry: codesOf(family.specPath),
      specs: new Set([family.specPath]),
    }
  )
}

/**
 * Every code any registry declares.
 *
 * Deliberately global rather than a corpus's reach. A family's prose
 * legitimately names another family's code — component §10 names blueprint's
 * `ERR_UNKNOWN_COMPONENT`, listing §3 names `ERR_UNREFERENCED_COMPONENT` — and
 * those are citations, not declarations. What `checkProseCodes` asks is whether
 * the code exists at all.
 */
function declaredCodes(families: readonly Family[]): ReadonlySet<string> {
  const codes = new Set<string>()
  for (const family of families) {
    for (const code of codesOf(family.specPath).keys()) codes.add(code)
  }
  return codes
}

function loadIndex(family: Family, failures: Failures): CaseIndexEntry[] {
  const indexPath = join(family.conformanceDir, 'cases.json')
  if (!existsSync(indexPath)) return []

  const index = readJson(indexPath)
  if (!isObject(index) || !Array.isArray(index.cases)) {
    failures.add(`${relativeToRepo(indexPath)}: must be an object with a "cases" array`)
    return []
  }
  // The index says which corpus it is. A core index that said `component` would
  // be read by an adapter as a family corpus, and run through a bundle.
  if (index.family !== undefined && index.family !== family.name) {
    failures.add(
      `${relativeToRepo(indexPath)}: "family" is ${JSON.stringify(index.family)} but the ` +
        `corpus lives under ${familyKey(family)}`,
    )
  }

  const entries: CaseIndexEntry[] = []
  for (const raw of index.cases as Json[]) {
    if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.path !== 'string') {
      failures.add(`${relativeToRepo(indexPath)}: every case needs string "id" and "path"`)
      continue
    }
    entries.push({ id: raw.id, phase: raw.phase as Phase, path: raw.path })
  }
  return entries
}

/**
 * A path is safe to join onto a materialised tree when it is relative and stays
 * inside it. Link *targets* are exempt — escaping is the thing some of them test
 * — but the link's own location is not.
 */
function isContainedRelative(path: string): boolean {
  return !isAbsolute(path) && !normalize(path).startsWith('..')
}

/**
 * ADR 0002 — a case declares its subject as exactly one of `case.yaml` (a
 * document with no item root) or `tree/` (a document inside one). Declaring both
 * would leave it ambiguous which one the diagnostics describe; declaring neither
 * leaves nothing to validate.
 */
function checkCaseSubject(
  caseDir: string,
  label: string,
  metadata: CaseMetadata,
  failures: Failures,
): boolean {
  const hasDocument = existsSync(join(caseDir, 'case.yaml'))
  const hasTree = existsSync(join(caseDir, 'tree'))

  if (hasDocument === hasTree) {
    failures.add(
      `${label}: a case declares exactly one of case.yaml or tree/, not ${hasTree ? 'both' : 'neither'}`,
    )
    return false
  }

  if (!hasTree) {
    if (metadata.document !== undefined || metadata.symlinks !== undefined) {
      failures.add(`${label}: "document" and "symlinks" belong to a tree case`)
      return false
    }
    return true
  }

  let ok = true
  if (metadata.document === undefined) {
    failures.add(`${label}: a tree case must name its "document" relative to tree/`)
    return false
  }
  if (!isContainedRelative(metadata.document)) {
    failures.add(`${label}: "document" must be a relative path inside tree/`)
    return false
  }
  if (!existsSync(join(caseDir, 'tree', metadata.document))) {
    failures.add(`${label}: "document" names ${metadata.document}, which is not in tree/`)
    ok = false
  }
  // tree/ is the *parent* of the item root, so that the item directory has a
  // name a fixture can test ERR_SLUG_MISMATCH against (ADR 0002 §1).
  if (dirname(metadata.document) === '.') {
    failures.add(`${label}: "document" must sit inside an item directory under tree/`)
    ok = false
  }
  for (const link of Object.keys(metadata.symlinks ?? {})) {
    if (!isContainedRelative(link)) {
      failures.add(`${label}: symlink "${link}" must be a relative path inside tree/`)
      ok = false
    }
  }
  return ok
}

/**
 * The shape a core case has beyond every case's (core v1 §8.1): a `case.yaml`
 * and never a `tree/`, because a case about an item needs a document of some
 * family inside a directory; and no `effective` map, because the parser alone
 * decides nothing about what a document means. The phase is checked with the
 * citations, in `checkClauseConsistency`.
 */
function checkCoreCase(caseDir: string, label: string, metadata: CaseMetadata, failures: Failures) {
  let ok = true
  if (existsSync(join(caseDir, 'tree'))) {
    failures.add(
      `${label}: a core case is a case.yaml, never a tree/ — a case about an item needs a ` +
        'document of some family (core v1 §8.1)',
    )
    ok = false
  }
  if (metadata.effective !== undefined) {
    failures.add(
      `${label}: a core case runs through the parser alone and declares no "effective" ` +
        'values (core v1 §8.1)',
    )
    ok = false
  }
  return ok
}

/** A `clause` split into the spec it cites and the anchor within it. */
interface Clause {
  /** Absolute path of the cited spec.md. */
  readonly specPath: string
  /** The path as the case wrote it, for messages. */
  readonly written: string
  readonly fragment: string | undefined
}

function parseClause(repoRoot: string, clause: string): Clause {
  const hash = clause.indexOf('#')
  const written = hash === -1 ? clause : clause.slice(0, hash)
  return {
    specPath: inRepo(repoRoot, written),
    written,
    fragment: hash === -1 ? undefined : clause.slice(hash + 1),
  }
}

/**
 * A case's `clause` and its `requirements` point at the same rules.
 *
 * Each is checked alone elsewhere — the clause resolves to an anchor, every ID
 * resolves to a declaration — and both can pass while the case says two
 * different things: twelve parser cases once cited `#envelope` while pinning a
 * YAML-profile rule declared somewhere else. For a case in corpus F, with D the
 * specs declaring its requirements (docs/conformance.md, the `clause` row):
 *
 * - (a) every spec in D is F's own, core's, or a normative dependency F's §2
 *   declares — a corpus pins only rules its family applies;
 * - (b) `clause` cites F's spec or a spec in D; with no requirements, a spec F
 *   may cite at all;
 * - (c) where `clause` cites a spec in D, its anchor is the section declaring
 *   each requirement that spec declares, or a section enclosing it;
 * - (d) a core case is a `parser` case and cites core only.
 */
export function checkClauseConsistency(
  context: Context,
  family: Family,
  label: string,
  metadata: Pick<CaseMetadata, 'phase' | 'clause' | 'requirements'>,
  failures: Failures,
): boolean {
  let ok = true
  const fail = (message: string) => {
    failures.add(`${label}: ${message}`)
    ok = false
  }
  const reach = reachOf(context, family)
  const own = family.specPath

  // Requirement to declaring spec. An ID that resolves nowhere is reported by
  // `checkCaseShape`; it constrains nothing here.
  const declaring = new Map<string, string>()
  for (const requirement of metadata.requirements ?? []) {
    const specPath = context.requirements.get(requirement)
    if (specPath !== undefined) declaring.set(requirement, specPath)
  }
  const clause =
    metadata.clause === undefined ? undefined : parseClause(context.repoRoot, metadata.clause)
  const rel = (path: string) => relativeToRepo(path).replace(`${context.repoRoot}/`, '')

  if (family.role === 'core') {
    // (d)
    if (metadata.phase !== 'parser') {
      fail(
        `a core case is a parser case, not ${metadata.phase} — core publishes no schema, and ` +
          'an adapter runs a core case through its parser alone (core v1 §8.1)',
      )
    }
    if (clause !== undefined && clause.specPath !== own) {
      fail(`a core case cites core only, but clause cites ${clause.written}`)
    }
    for (const [requirement, specPath] of declaring) {
      if (specPath !== own) {
        fail(`a core case cites core only, but ${requirement} is declared in ${rel(specPath)}`)
      }
    }
  } else {
    // (a)
    for (const [requirement, specPath] of declaring) {
      if (reach.specs.has(specPath)) continue
      fail(
        `${requirement} is declared in ${rel(specPath)}, which is neither ` +
          `${rel(own)}, core, nor a normative dependency ${familyKey(family)} §2 declares`,
      )
    }
    // (b)
    if (clause !== undefined) {
      const cited = new Set(declaring.values())
      if (cited.size > 0 && clause.specPath !== own && !cited.has(clause.specPath)) {
        fail(
          `clause cites ${clause.written}, which declares none of this case's requirements ` +
            `and is not ${rel(own)}`,
        )
      } else if (cited.size === 0 && !reach.specs.has(clause.specPath)) {
        fail(
          `clause cites ${clause.written}, which is neither ${rel(own)}, core, nor a ` +
            `normative dependency ${familyKey(family)} §2 declares`,
        )
      }
    }
  }

  // (c)
  if (clause?.fragment !== undefined) {
    const outline = specIndex(clause.specPath)?.outline
    for (const [requirement, specPath] of declaring) {
      if (outline === undefined || specPath !== clause.specPath) continue
      const enclosing = enclosingSections(outline, requirement)
      if (enclosing.includes(clause.fragment)) continue
      fail(
        `clause cites #${clause.fragment}, but ${requirement} is declared under ` +
          `${enclosing.map((id) => `#${id}`).join(' within ') || 'no section'} of ` +
          `${clause.written}. Cite that section or one enclosing it.`,
      )
    }
  }

  return ok
}

/**
 * Copy a case's `tree/` somewhere writable and create its declared symlinks.
 * Returns the scratch root; the caller removes it.
 *
 * Links are made here rather than committed because a committed one does not
 * survive a checkout without `core.symlinks`, is invisible in a diff, and would
 * ship inside a release tarball pointing outside the archive (ADR 0002 §3).
 */
function materialiseTree(caseDir: string, metadata: CaseMetadata): string {
  const scratch = mkdtempSync(join(tmpdir(), 'musher-conformance-'))
  cpSync(join(caseDir, 'tree'), scratch, { recursive: true })
  for (const [link, target] of Object.entries(metadata.symlinks ?? {})) {
    const path = join(scratch, link)
    mkdirSync(dirname(path), { recursive: true })
    rmSync(path, { force: true })
    symlinkSync(target, path)
  }
  return scratch
}

/**
 * Check the parts of a case that hold whether or not the phase runs here: the
 * declared outcome, the clause it traces to, and the codes it names.
 *
 * Returns the declared diagnostics so the executing half does not re-read them,
 * or `null` when the case is malformed.
 */
function checkCaseShape(
  context: Context,
  family: Family,
  entry: CaseIndexEntry,
  caseDir: string,
  label: string,
  metadata: CaseMetadata,
  failures: Failures,
): DeclaredDiagnostic[] | null {
  let ok = true

  if (!PHASES.includes(metadata.phase)) {
    failures.add(`${label}: phase "${metadata.phase}" is not one of ${PHASES.join(', ')}`)
    return null
  }
  if (entry.phase !== metadata.phase) {
    failures.add(
      `${label}: cases.json says phase "${entry.phase}" but metadata.json says "${metadata.phase}"`,
    )
    ok = false
  }
  if (!metadata.id.startsWith(`${metadata.phase}-`)) {
    failures.add(`${label}: id must follow <phase>-<NNN>-<description> and lead with the phase`)
    ok = false
  }
  if (!checkCaseSubject(caseDir, label, metadata, failures)) ok = false
  if (family.role === 'core' && !checkCoreCase(caseDir, label, metadata, failures)) ok = false

  // Every case should trace to prose — a fixture that cites nothing is an
  // assertion about an implementation, not about the specification.
  if (metadata.clause !== undefined) {
    const clause = parseClause(context.repoRoot, metadata.clause)
    const cited = specIndex(clause.specPath)
    if (cited === undefined) {
      failures.add(`${label}: clause cites ${clause.written}, which does not exist`)
      ok = false
    } else if (clause.fragment === undefined || !cited.anchors.has(clause.fragment)) {
      failures.add(
        `${label}: clause anchor #${clause.fragment ?? ''} is not declared in ${clause.written}`,
      )
      ok = false
    }
  }

  // A requirement ID must resolve to an anchor in a spec.md, exactly as a
  // clause does. An ID that resolves nowhere is worse than no ID: it reads as
  // traceability and provides none.
  for (const requirement of metadata.requirements ?? []) {
    if (!REQUIREMENT_ID.test(requirement)) {
      failures.add(`${label}: "${requirement}" is not a requirement ID (<FAM>-<SECTION>-<NNN>)`)
      ok = false
      continue
    }
    if (!context.requirements.has(requirement)) {
      failures.add(
        `${label}: requirement ${requirement} is not declared in any spec.md. ` +
          'Declare it beside the rule it names, or cite one that exists.',
      )
      ok = false
    }
  }

  if (!checkClauseConsistency(context, family, label, metadata, failures)) ok = false

  // An `effective` map pins what a document means where it says nothing, which
  // is only a question about a document that was accepted.
  if (metadata.effective !== undefined) {
    if (!isObject(metadata.effective as Json)) {
      failures.add(`${label}: metadata.effective must be an object keyed by JSON Pointer`)
      ok = false
    } else if (metadata.expected !== 'pass') {
      failures.add(
        `${label}: metadata.effective is for a passing case. A rejected document has no ` +
          'effective values — it has diagnostics.',
      )
      ok = false
    } else {
      for (const pointer of Object.keys(metadata.effective)) {
        if (pointer === '' || !pointer.startsWith('/')) {
          failures.add(`${label}: metadata.effective key "${pointer}" is not a JSON Pointer`)
          ok = false
        }
      }
    }
  }

  if (metadata.expected === 'pass') return ok ? [] : null

  const diagnosticsPath = join(caseDir, 'diagnostics.json')
  if (!existsSync(diagnosticsPath)) {
    failures.add(`${label}: a failing case must declare diagnostics.json`)
    return null
  }
  const declared = readJson(diagnosticsPath)
  if (!Array.isArray(declared) || declared.length === 0) {
    failures.add(`${label}: diagnostics.json must be a non-empty array`)
    return null
  }

  const { registry } = reachOf(context, family)
  const diagnostics: DeclaredDiagnostic[] = []
  for (const item of declared as Json[]) {
    if (!isObject(item) || typeof item.code !== 'string' || typeof item.path !== 'string') {
      failures.add(`${label}: every diagnostic needs string "code" and "path"`)
      return null
    }
    const declaredPhase = registry.get(item.code)
    if (declaredPhase === undefined) {
      failures.add(
        `${label}: ${item.code} is declared by no diagnostics table reachable from ` +
          `${relativeToRepo(family.specPath)}`,
      )
      ok = false
    } else if (declaredPhase !== metadata.phase) {
      failures.add(
        `${label}: ${item.code} is a ${declaredPhase}-phase code but the case declares ` +
          `${metadata.phase}`,
      )
      ok = false
    }
    diagnostics.push({ code: item.code, path: item.path })
  }

  return ok ? diagnostics : null
}

/**
 * Every pinned effective value is the one the contract actually yields.
 *
 * ADR 0008. The map is the normative claim; this checks it against the bundle
 * and the document so a fixture cannot pin a default the schema does not
 * declare, or contradict a value the author wrote down.
 */
function checkEffective(
  family: Family,
  caseDir: string,
  label: string,
  metadata: CaseMetadata,
  failures: Failures,
): boolean {
  const pinned = metadata.effective
  if (pinned === undefined || Object.keys(pinned).length === 0) return true

  const source =
    metadata.document === undefined
      ? readFileSync(join(caseDir, 'case.yaml'), 'utf8')
      : readFileSync(join(caseDir, 'tree', metadata.document), 'utf8')

  const parsed = parseDocument(source)
  if ('errors' in parsed) {
    failures.add(`${label}: effective values declared on a document that does not parse`)
    return false
  }

  const bundle = JSON.parse(familyBundle(family) ?? 'null') as Json
  let ok = true

  for (const [pointer, expected] of Object.entries(pinned)) {
    let resolution: ReturnType<typeof effectiveValue>
    try {
      pointerSegments(pointer)
      resolution = effectiveValue(bundle, parsed.value, pointer)
    } catch (error) {
      failures.add(`${label}: ${pointer} could not be resolved — ${(error as Error).message}`)
      ok = false
      continue
    }

    if (resolution.kind === 'absent') {
      failures.add(`${label}: ${pointer} pins an effective value but ${resolution.reason}`)
      ok = false
      continue
    }

    if (canonicalJson(resolution.value) !== canonicalJson(expected)) {
      const from = resolution.kind === 'written' ? 'the document' : 'the schema default'
      failures.add(
        `${label}: ${pointer} is pinned as ${JSON.stringify(expected)} but ${from} says ` +
          `${JSON.stringify(resolution.value)}`,
      )
      ok = false
    }
  }

  return ok
}

/**
 * Validate a case's subject, supplying an item root only when the case declares
 * one. A `case.yaml` deliberately supplies none: core v1 §4.1 says a document
 * arriving without a directory has no item root, and the rules measured against
 * one MUST NOT be reported for it.
 */
function runValidation(family: Family, caseDir: string, metadata: CaseMetadata) {
  if (metadata.document === undefined) {
    return validateDocument(family, readFileSync(join(caseDir, 'case.yaml'), 'utf8'))
  }

  const scratch = materialiseTree(caseDir, metadata)
  try {
    const documentPath = join(scratch, metadata.document)
    return validateDocument(family, readFileSync(documentPath, 'utf8'), {
      itemRoot: dirname(documentPath),
      documentPath,
    })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Run a core case the way core v1 §8.1 says an adapter does: through the parser
 * alone. No bundle is read, no later phase is entered, and nothing looks at the
 * document's `kind` — the parser runs before a family is chosen, so there is no
 * family to choose.
 */
function runParserOnly(caseDir: string): {
  readonly ok: boolean
  readonly phase: Phase
  readonly diagnostics: Diagnostic[]
} {
  const parsed = parseDocument(readFileSync(join(caseDir, 'case.yaml'), 'utf8'))
  return 'errors' in parsed
    ? { ok: false, phase: 'parser', diagnostics: parsed.errors }
    : { ok: true, phase: 'parser', diagnostics: [] }
}

export type Log = (line: string) => void

function runCase(
  context: Context,
  family: Family,
  entry: CaseIndexEntry,
  failures: Failures,
  /** Collects every code the corpus declares, for the coverage check. */
  exercised: Set<string>,
  /** Collects every requirement ID the corpus cites, for the same reason. */
  citedRequirements: Set<string>,
  log: Log,
): 'ran' | 'skipped' | 'failed' {
  const caseDir = join(family.conformanceDir, entry.path)
  const label = `${familyKey(family)}/${entry.id}`

  const metadataPath = join(caseDir, 'metadata.json')
  if (!existsSync(metadataPath)) {
    failures.add(`${label}: missing ${relativeToRepo(metadataPath)}`)
    return 'failed'
  }

  const metadata = readJson(metadataPath) as unknown as CaseMetadata
  if (metadata.id !== entry.id) {
    failures.add(`${label}: metadata.json id is "${metadata.id}" but cases.json says "${entry.id}"`)
    return 'failed'
  }
  if (metadata.expected !== 'pass' && metadata.expected !== 'fail') {
    failures.add(`${label}: metadata.expected must be "pass" or "fail"`)
    return 'failed'
  }

  const declared = checkCaseShape(context, family, entry, caseDir, label, metadata, failures)
  if (declared === null) return 'failed'
  for (const item of declared) exercised.add(item.code)
  for (const requirement of metadata.requirements ?? []) citedRequirements.add(requirement)

  if (!IMPLEMENTED_PHASES.has(metadata.phase)) {
    log(`  · ${label}: ${metadata.phase} phase not implemented here — skipped`)
    return 'skipped'
  }

  let result: ReturnType<typeof runParserOnly>
  if (family.role === 'core') {
    result = runParserOnly(caseDir)
  } else {
    if (familyBundle(family) === null) {
      failures.add(`${label}: no schema modules authored to validate against`)
      return 'failed'
    }
    result = runValidation(family, caseDir, metadata)
  }

  if (metadata.expected === 'pass') {
    if (result.ok) {
      if (family.role !== 'core' && !checkEffective(family, caseDir, label, metadata, failures)) {
        return 'failed'
      }
      log(`  ✓ ${label}`)
      return 'ran'
    }
    const detail = result.diagnostics.map((d) => `        ${d.code} at ${d.path || '/'}`).join('\n')
    failures.add(`${label}: expected to pass but failed in ${result.phase}:\n${detail}`)
    return 'failed'
  }

  if (result.ok) {
    failures.add(
      family.role === 'core'
        ? `${label}: expected the parser to reject it, but the parser accepted it`
        : `${label}: expected to fail but validated cleanly`,
    )
    return 'failed'
  }
  if (result.phase !== metadata.phase) {
    failures.add(`${label}: expected failure in the ${metadata.phase} phase, got ${result.phase}`)
    return 'failed'
  }

  // Diagnostic codes and the failing phase are normative; message text is not.
  const produced = new Set(result.diagnostics.map((d) => `${d.code}@${d.path}`))
  for (const item of declared) {
    if (!produced.has(`${item.code}@${item.path}`)) {
      failures.add(
        `${label}: declared diagnostic ${item.code} at ${item.path || '/'} was not produced.\n` +
          `      produced: ${[...produced].join(', ') || '(none)'}`,
      )
      return 'failed'
    }
  }

  log(`  ✓ ${label} (fails as declared)`)
  return 'ran'
}

/**
 * Diagnostic codes deliberately left without a fixture, and why. Every entry is
 * a claim a reviewer can check; the list is short on purpose.
 */
const UNCOVERED: ReadonlyMap<string, string> = new Map([
  [
    'ERR_UNKNOWN_COMPONENT',
    'capability — resolving a published reference needs the catalog, and no phase this repository runs may reach the network',
  ],
  [
    'ERR_VERSION_NOT_MONOTONIC',
    'capability — comparing a version against the lineage it extends needs the catalog, and a fixture is one document with no previous release to be greater than',
  ],
  [
    'ERR_COMPONENT_NOT_PUBLISHED',
    'capability — only the registry holds publication state, so deciding it needs the catalog, and a fixture is a tree of files none of which has one',
  ],
  [
    'ERR_UNKNOWN_COMPUTE_PROFILE',
    'capability — the grammar is fixtured (structural/015 through 018), but which profiles are offered changes when the platform gains hardware to back a tier, so deciding membership needs the catalog',
  ],
  [
    'ERR_UNKNOWN_RESOURCE_TYPE',
    'capability — the grammar is fixtured, but membership is a registry ADR 0009 §2 puts outside this repository, so deciding it needs the network; ADR 0009 §3 forbids an offline client from reporting it at all, which makes a grammatical identifier the registry does not name reserved rather than invalid',
  ],
])

/**
 * The reverse of `checkCaseShape`'s registry check.
 *
 * That one asks whether every code a fixture *declares* is defined by the prose.
 * This one asks whether every code the prose *defines* is exercised by a
 * fixture — the direction nothing enforced, and the direction ten codes reached
 * `main` untested in with CI green.
 *
 * A code goes uncovered only by someone adding it to `UNCOVERED` with a reason,
 * in a diff a reviewer sees.
 *
 * For a kind family, `exercised` is its own corpus's codes, and only the
 * family's own additions are asked about: demanding that every family fixture
 * every code it reaches would make each one restate the envelope suite. For
 * core, `exercised` is every corpus's: core's corpus is parser-only, so its
 * structural and item codes are fixtured in the family corpora that apply them.
 */
function checkCoverage(family: Family, exercised: ReadonlySet<string>, failures: Failures): void {
  const where = family.role === 'core' ? 'no indexed case in any corpus' : 'no indexed case'
  for (const code of codesOf(family.specPath).keys()) {
    if (exercised.has(code) || UNCOVERED.has(code)) continue
    failures.add(
      `${familyKey(family)}: ${code} is declared in ${relativeToRepo(family.specPath)} ` +
        `but ${where} exercises it. Add a fixture, or record it in UNCOVERED with a reason.`,
    )
  }
}

/**
 * Requirements no fixture pins, and why that is allowed.
 *
 * The same shape as `UNCOVERED` and for the same reason: a requirement without
 * a fixture goes untested only when someone writes down why, in a diff a
 * reviewer sees. Most entries here are rules about what an *implementation*
 * does — network access, what it prints — which a document cannot exercise.
 */
const UNPINNED: ReadonlyMap<string, string> = new Map([
  [
    'CORE-ENV-001',
    'A fixture cannot omit specVersion and still declare which family it belongs ' +
      'to; the rule is exercised indirectly by every case in every corpus',
  ],
  [
    'CORE-ENV-003',
    'metadata is required by every fixture in every corpus, so no single case pins it',
  ],
  ['CORE-ENV-004', 'spec is required by every fixture in every corpus, so no single case pins it'],
  [
    'LIST-MEDIA-004',
    'a rule about what a consumer emits once it has relocated an item media set; ' +
      'the corpus validates documents and cannot observe a storefront output, the ' +
      'same limit ADR 0004 records for the listing §4.1 renderer clause',
  ],
])

/**
 * Every declared requirement is pinned by a fixture, or excused in `UNPINNED`.
 *
 * This is the same bidirectional gate `checkCoverage` applies to diagnostic
 * codes, for the same reason: without it, a rule can be written into the
 * specification and never tested, and CI stays green because nothing asked.
 * A `CORE-*` ID counts as pinned when a case in any corpus cites it.
 */
function checkRequirementCoverage(
  requirements: ReadonlyMap<string, string>,
  cited: ReadonlySet<string>,
  failures: Failures,
): void {
  for (const [requirement, specPath] of requirements) {
    if (cited.has(requirement) || UNPINNED.has(requirement)) continue
    failures.add(
      `${requirement} is declared in ${relativeToRepo(specPath)} but no case cites it. ` +
        'Add "requirements" to a fixture, or record it in UNPINNED with a reason.',
    )
  }
}

/**
 * Codes the prose names on purpose without declaring them, and why.
 *
 * The same shape as `UNCOVERED` and `UNPINNED`, for the same reason. An entry
 * here is a claim a reviewer can check, and the list should stay near empty:
 * naming a code that does not exist is how a withdrawn rule survives.
 */
const HYPOTHETICAL: ReadonlyMap<string, string> = new Map([
  [
    'ERR_SCHEMA_TOO_OLD',
    'core §3 names it as a code that deliberately does not exist, to explain why a field from a newer release is reported as ERR_UNKNOWN_FIELD — a validator holding neither definition cannot tell that case from a misspelling',
  ],
])

/**
 * Every diagnostic code the prose names is declared by a registry.
 *
 * The third direction, and the one nothing checked. `checkCaseShape` asks
 * whether a code a *fixture* declares exists; `checkCoverage` asks whether a
 * code a *registry* declares is fixtured. Neither looks at a code named in a
 * sentence — which is how blueprint §10 came to reject a cycle §4.2 permits,
 * with `ERR_CONNECTION_CYCLE`, a code no table has ever defined, and CI green.
 *
 * Scoped to the spec.md files. An ADR is immutable and records withdrawn codes
 * as history, so a code that no longer exists is correct there; a named code is
 * a promise only in a normative document.
 */
function checkProseCodes(families: readonly Family[], failures: Failures): void {
  const declared = declaredCodes(families)
  for (const family of families) {
    if (!existsSync(family.specPath)) continue
    const lines = readFileSync(family.specPath, 'utf8').split('\n')
    for (const [offset, line] of lines.entries()) {
      for (const match of line.matchAll(PROSE_CODE)) {
        const code = match[1]
        if (code === undefined || declared.has(code) || HYPOTHETICAL.has(code)) continue
        failures.add(
          `${relativeToRepo(family.specPath)}:${offset + 1}: ${code} is named in the prose but ` +
            'is declared by no diagnostics table. Add it to a registry, or record it in ' +
            'HYPOTHETICAL with a reason.',
        )
      }
    }
  }
}

/**
 * Case directories that no `cases.json` entry names. The index is the contract
 * and the runner never walks the filesystem, so an unindexed directory is not a
 * failing fixture — it is an invisible one, which is worse.
 */
function checkOrphans(family: Family, entries: CaseIndexEntry[], failures: Failures): void {
  const indexed = new Set(entries.map((entry) => normalize(entry.path)))
  for (const phase of PHASES) {
    const phaseDir = join(family.conformanceDir, phase)
    if (!existsSync(phaseDir)) continue
    for (const name of readdirSync(phaseDir)) {
      if (!statSync(join(phaseDir, name)).isDirectory()) continue
      if (indexed.has(normalize(join(phase, name)))) continue
      failures.add(
        `${familyKey(family)}: ${phase}/${name} is not indexed in cases.json and runs nowhere`,
      )
    }
  }
}

export interface ConformanceResult {
  readonly failures: Failures
  readonly ran: number
  readonly skipped: number
  /** Indexed cases per corpus, keyed `<name>/<major>`, in discovery order. */
  readonly corpora: ReadonlyMap<string, number>
  /** Declared requirement IDs cited by at least one case. */
  readonly pinned: number
  readonly requirements: number
}

/** Run every corpus under `repoRoot`, collecting failures rather than exiting. */
export function runConformance(
  repoRoot: string = REPO_ROOT,
  log: Log = console.log,
): ConformanceResult {
  const failures = new Failures()
  const context = loadContext(repoRoot, failures)
  let ran = 0
  let skipped = 0
  const corpora = new Map<string, number>()

  // Requirement IDs are global, so coverage is answered across the whole corpus
  // rather than per family: a blueprint fixture may be the only thing pinning a
  // component rule, and every core structural rule is pinned in a family corpus.
  const cited = new Set<string>()
  const exercisedAnywhere = new Set<string>()

  for (const family of context.families) {
    const entries = loadIndex(family, failures)
    corpora.set(familyKey(family), entries.length)
    if (entries.length === 0) {
      log(`  · ${familyKey(family)}: no conformance cases indexed`)
      continue
    }

    const exercised = new Set<string>()
    for (const entry of entries) {
      const outcome = runCase(context, family, entry, failures, exercised, cited, log)
      if (outcome === 'ran') ran += 1
      if (outcome === 'skipped') skipped += 1
    }
    for (const code of exercised) exercisedAnywhere.add(code)

    if (family.role !== 'core') checkCoverage(family, exercised, failures)
    checkOrphans(family, entries, failures)
  }

  // Core's codes are covered by any corpus, so they are asked about only once
  // every corpus has run.
  for (const family of context.families) {
    if (family.role === 'core') checkCoverage(family, exercisedAnywhere, failures)
  }

  checkRequirementCoverage(context.requirements, cited, failures)
  checkProseCodes(context.families, failures)

  let pinned = 0
  for (const requirement of context.requirements.keys()) if (cited.has(requirement)) pinned += 1

  return {
    failures,
    ran,
    skipped,
    corpora,
    pinned,
    requirements: context.requirements.size,
  }
}

function main(): void {
  const result = runConformance()
  const suffix = result.skipped > 0 ? ` (${result.skipped} skipped)` : ''
  const profile = profileFor(IMPLEMENTED_PHASES) ?? 'none'
  const corpora = [...result.corpora].map(([key, count]) => `${key} ${count}`).join(', ')
  result.failures.report(
    result.ran === 0
      ? `No conformance cases executed${suffix}.`
      : `${result.ran} conformance case(s) passed${suffix} — profile: ${profile}; ` +
          `${result.pinned}/${result.requirements} requirement(s) pinned. Cases per corpus: ${corpora}.`,
  )
}

if (import.meta.main) main()
