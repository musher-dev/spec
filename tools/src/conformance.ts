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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  readonly summary?: string
}

interface DeclaredDiagnostic {
  readonly code: string
  readonly path: string
}

const PHASES: readonly Phase[] = ['parser', 'structural', 'semantic', 'capability']

const IMPLEMENTED_PHASES = new Set<Phase>(['parser', 'structural'])

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

function runCase(
  family: Family,
  entry: CaseIndexEntry,
  failures: Failures,
): 'ran' | 'skipped' | 'failed' {
  const caseDir = join(family.conformanceDir, entry.path)
  const label = `${family.name}/${family.major}/${entry.id}`

  const metadataPath = join(caseDir, 'metadata.json')
  const documentPath = join(caseDir, 'case.yaml')
  for (const required of [metadataPath, documentPath]) {
    if (!existsSync(required)) {
      failures.add(`${label}: missing ${relativeToRepo(required)}`)
      return 'failed'
    }
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

  if (!IMPLEMENTED_PHASES.has(metadata.phase)) {
    console.log(`  · ${label}: ${metadata.phase} phase not implemented here — skipped`)
    return 'skipped'
  }

  if (!existsSync(family.bundlePath)) {
    failures.add(`${label}: no bundle to validate against — run \`task bundle\``)
    return 'failed'
  }

  const result = validateDocument(family, readFileSync(documentPath, 'utf8'))

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

function main(): void {
  const failures = new Failures()
  let ran = 0
  let skipped = 0

  for (const family of discoverFamilies()) {
    const entries = loadIndex(family, failures)
    if (entries.length === 0) {
      console.log(`  · ${family.name}/${family.major}: no conformance cases indexed`)
      continue
    }
    for (const entry of entries) {
      const outcome = runCase(family, entry, failures)
      if (outcome === 'ran') ran += 1
      if (outcome === 'skipped') skipped += 1
    }
  }

  const suffix = skipped > 0 ? ` (${skipped} skipped)` : ''
  failures.report(
    ran === 0
      ? `No conformance cases executed${suffix}.`
      : `${ran} conformance case(s) passed${suffix}.`,
  )
}

main()
