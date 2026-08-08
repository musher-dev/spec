/**
 * Execute the language-neutral conformance corpus.
 *
 * This runner exists to keep the fixtures honest inside this repository. It is
 * NOT the normative runner — there deliberately is none. Downstream
 * implementations write their own adapter over the same data, which is what
 * makes cross-language parity provable rather than asserted.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  discoverFamilies,
  Failures,
  type Family,
  isObject,
  type Json,
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

const IMPLEMENTED_PHASES = new Set<Phase>(['parser', 'structural'])

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
  const diagnosticsPath = join(caseDir, 'diagnostics.json')
  if (!existsSync(diagnosticsPath)) {
    failures.add(`${label}: a failing case must declare diagnostics.json`)
    return 'failed'
  }
  const declared = readJson(diagnosticsPath)
  if (!Array.isArray(declared) || declared.length === 0) {
    failures.add(`${label}: diagnostics.json must be a non-empty array`)
    return 'failed'
  }

  const produced = new Set(result.diagnostics.map((d) => `${d.code}@${d.path}`))
  for (const item of declared as Json[]) {
    if (!isObject(item) || typeof item.code !== 'string' || typeof item.path !== 'string') {
      failures.add(`${label}: every diagnostic needs string "code" and "path"`)
      return 'failed'
    }
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
