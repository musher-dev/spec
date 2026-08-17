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
import { type Phase, validateDocument } from './validator.ts'

interface CaseIndexEntry {
  readonly id: string
  readonly phase: Phase
  readonly path: string
}

interface CaseMetadata {
  readonly id: string
  readonly phase: Phase
  readonly expected: 'pass' | 'fail'
  readonly clause?: string
  /**
   * Stable requirement identifiers this case exercises, e.g. `COMP-ENV-002`.
   *
   * `clause` names a section; a section states several rules. 27 cases cite
   * `#envelope`, which covers `specVersion`, `kind`, unknown fields, and an
   * unsupported version — so the citation says where to look and not what is
   * being pinned. An ID says which rule, and survives a heading being renamed.
   */
  readonly requirements?: string[]
  readonly summary?: string
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
 * The profiles conformance/README.md defines, cumulative and in order.
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

/**
 * The family whose diagnostics table the other families declare themselves
 * deltas on: blueprint §7 and listing §7 both open "The codes in component §8
 * apply. This family adds:". The registry a fixture may draw on is therefore
 * its own family's table unioned with this one's.
 */
const BASE_FAMILY = 'component'

/** A row of a `| Code | Phase | Meaning |` table in a spec.md. */
const DIAGNOSTIC_ROW = /^\|\s*`(ERR_[A-Z0-9_]+)`\s*\|\s*`([a-z]+)`\s*\|/
/** A stable heading anchor, `## <a id="envelope"></a>2. Document envelope`. */
const SPEC_ANCHOR = /<a id="([^"]+)"><\/a>/g

interface SpecIndex {
  /** Diagnostic code to the phase the prose assigns it. */
  readonly codes: ReadonlyMap<string, Phase>
  readonly anchors: ReadonlySet<string>
}

const EMPTY_INDEX: SpecIndex = { codes: new Map(), anchors: new Set() }

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
    index = { codes, anchors }
  }
  specIndexCache.set(path, index)
  return index
}

/** A stable requirement identifier: `COMP-ENV-001`, `BP-REF-003`. */
const REQUIREMENT_ID = /^[A-Z]{2,6}-[A-Z0-9]{2,12}-\d{3}$/

let requirementCache: Map<string, string> | undefined

/**
 * Every requirement ID declared across the three specifications, mapped to the
 * document that declares it.
 *
 * IDs are global rather than per-family on purpose: a blueprint fixture cites
 * component's envelope requirements, and the prefix already says which document
 * to open. Two documents declaring the same ID is a defect — the same name
 * would mean two rules.
 */
function requirementIndex(): Map<string, string> {
  if (requirementCache !== undefined) return requirementCache
  const index = new Map<string, string>()
  for (const family of discoverFamilies()) {
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
  requirementCache = index
  return index
}

/** Every diagnostic code a fixture in this family may legitimately declare. */
function registryFor(family: Family): ReadonlyMap<string, Phase> {
  const own = specIndex(family.specPath) ?? EMPTY_INDEX
  const base = specIndex(family.specPath.replace(`/${family.name}/`, `/${BASE_FAMILY}/`))
  return new Map([...(base ?? EMPTY_INDEX).codes, ...own.codes])
}

function loadIndex(family: Family, failures: Failures): CaseIndexEntry[] {
  const indexPath = join(family.conformanceDir, 'cases.json')
  if (!existsSync(indexPath)) return []

  const index = readJson(indexPath)
  if (!isObject(index) || !Array.isArray(index.cases)) {
    failures.add(`${relativeToRepo(indexPath)}: must be an object with a "cases" array`)
    return []
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

  // Every case should trace to prose — a fixture that cites nothing is an
  // assertion about an implementation, not about the specification.
  if (metadata.clause !== undefined) {
    const [clausePath, fragment] = metadata.clause.split('#')
    const cited = clausePath === undefined ? undefined : specIndex(join(REPO_ROOT, clausePath))
    if (cited === undefined) {
      failures.add(`${label}: clause cites ${clausePath}, which does not exist`)
      ok = false
    } else if (fragment === undefined || !cited.anchors.has(fragment)) {
      failures.add(`${label}: clause anchor #${fragment ?? ''} is not declared in ${clausePath}`)
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
    if (!requirementIndex().has(requirement)) {
      failures.add(
        `${label}: requirement ${requirement} is not declared in any spec.md. ` +
          'Declare it beside the rule it names, or cite one that exists.',
      )
      ok = false
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

  const registry = registryFor(family)
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
 * Validate a case's subject, supplying an item root only when the case declares
 * one. A `case.yaml` deliberately supplies none: blueprint §3.1 says a document
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

function runCase(
  family: Family,
  entry: CaseIndexEntry,
  failures: Failures,
  /** Collects every code the corpus declares, for the coverage check. */
  exercised: Set<string>,
  /** Collects every requirement ID the corpus cites, for the same reason. */
  citedRequirements: Set<string>,
): 'ran' | 'skipped' | 'failed' {
  const caseDir = join(family.conformanceDir, entry.path)
  const label = `${family.name}/${family.major}/${entry.id}`

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

  const declared = checkCaseShape(family, entry, caseDir, label, metadata, failures)
  if (declared === null) return 'failed'
  for (const item of declared) exercised.add(item.code)
  for (const requirement of metadata.requirements ?? []) citedRequirements.add(requirement)

  if (!IMPLEMENTED_PHASES.has(metadata.phase)) {
    console.log(`  · ${label}: ${metadata.phase} phase not implemented here — skipped`)
    return 'skipped'
  }

  if (!existsSync(family.bundlePath)) {
    failures.add(`${label}: no bundle to validate against — run \`task bundle\``)
    return 'failed'
  }

  const result = runValidation(family, caseDir, metadata)

  if (metadata.expected === 'pass') {
    if (result.ok) {
      console.log(`  ✓ ${label}`)
      return 'ran'
    }
    const detail = result.diagnostics.map((d) => `        ${d.code} at ${d.path || '/'}`).join('\n')
    failures.add(`${label}: expected to pass but failed in ${result.phase}:\n${detail}`)
    return 'failed'
  }

  if (result.ok) {
    failures.add(`${label}: expected to fail but validated cleanly`)
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

  console.log(`  ✓ ${label} (fails as declared)`)
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
 */
function checkCoverage(family: Family, exercised: ReadonlySet<string>, failures: Failures): void {
  // Only the family's own additions: a code inherited from component §8 is
  // covered by component's corpus, and demanding a fixture per family would
  // make every family restate the envelope suite.
  const own = specIndex(family.specPath)?.codes ?? new Map()
  for (const code of own.keys()) {
    if (exercised.has(code) || UNCOVERED.has(code)) continue
    failures.add(
      `${family.name}/${family.major}: ${code} is declared in ${relativeToRepo(family.specPath)} ` +
        'but no indexed case exercises it. Add a fixture, or record it in UNCOVERED with a reason.',
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
    'COMP-ENV-001',
    'A fixture cannot omit specVersion and still declare which family it belongs ' +
      'to; the rule is exercised indirectly by every case in the corpus',
  ],
  [
    'COMP-ENV-003',
    'metadata is required by every fixture in the corpus, so no single case pins it',
  ],
  ['COMP-ENV-004', 'spec is required by every fixture in the corpus, so no single case pins it'],
])

/**
 * Every declared requirement is pinned by a fixture, or excused in `UNPINNED`.
 *
 * This is the same bidirectional gate `checkCoverage` applies to diagnostic
 * codes, for the same reason: without it, a rule can be written into the
 * specification and never tested, and CI stays green because nothing asked.
 */
function checkRequirementCoverage(cited: ReadonlySet<string>, failures: Failures): void {
  for (const [requirement, specPath] of requirementIndex()) {
    if (cited.has(requirement) || UNPINNED.has(requirement)) continue
    failures.add(
      `${requirement} is declared in ${relativeToRepo(specPath)} but no case cites it. ` +
        'Add "requirements" to a fixture, or record it in UNPINNED with a reason.',
    )
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
        `${family.name}/${family.major}: ${phase}/${name} is not indexed in cases.json and runs nowhere`,
      )
    }
  }
}

function main(): void {
  const failures = new Failures()
  let ran = 0
  let skipped = 0

  // Requirement IDs are global, so coverage is answered across the whole corpus
  // rather than per family: a blueprint fixture may be the only thing pinning a
  // component envelope rule.
  const cited = new Set<string>()

  for (const family of discoverFamilies()) {
    const entries = loadIndex(family, failures)
    if (entries.length === 0) {
      console.log(`  · ${family.name}/${family.major}: no conformance cases indexed`)
      continue
    }

    const exercised = new Set<string>()
    for (const entry of entries) {
      const outcome = runCase(family, entry, failures, exercised, cited)
      if (outcome === 'ran') ran += 1
      if (outcome === 'skipped') skipped += 1
    }

    checkCoverage(family, exercised, failures)
    checkOrphans(family, entries, failures)
  }

  checkRequirementCoverage(cited, failures)

  const suffix = skipped > 0 ? ` (${skipped} skipped)` : ''
  const profile = profileFor(IMPLEMENTED_PHASES) ?? 'none'
  const requirements = requirementIndex().size
  failures.report(
    ran === 0
      ? `No conformance cases executed${suffix}.`
      : `${ran} conformance case(s) passed${suffix} — profile: ${profile}; ` +
          `${cited.size}/${requirements} requirement(s) pinned.`,
  )
}

if (import.meta.main) main()
