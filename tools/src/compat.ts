/**
 * Replay every document a released version accepted against the candidate
 * schema.
 *
 * `spec.md` §3 promises that a document validating against `v1.0.0` validates
 * against every later `v1.x.y`. Until now nothing checked it. The drift gate
 * proves the bundle matches its sources and the conformance corpus proves the
 * cases in it still behave — but the corpus is the corpus as it exists *now*,
 * so deleting a fixture and tightening the rule it covered passes both.
 *
 * A textual schema diff cannot settle this either: whether a change to a
 * `oneOf`, a conditional, or a pattern rejects some previously valid document
 * is a question about documents, not about schema text. So this replays the
 * documents.
 *
 * The corpus is read out of each release's own tag rather than the working
 * tree, which is what makes removing a fixture unable to hide a regression.
 *
 * NON-NORMATIVE, like everything under tools/.
 */

import { parseDocument } from './document.ts'
import { listTreeFiles, readBlobAtRef } from './git.ts'
import { discoverReleases, type Release } from './released.ts'
import { discoverFamilies, Failures, type Family, isObject, type Json, REPO_ROOT } from './spec.ts'
import { compileFamily } from './validator.ts'

interface Subject {
  /** Repo-relative path as of the tag, for the diagnostic. */
  readonly path: string
  readonly source: string
}

/**
 * Documents a release asserted were valid: its examples, and every conformance
 * case it declared `expected: "pass"`.
 */
function subjectsAt(repoRoot: string, family: Family, release: Release): Subject[] {
  const subjects: Subject[] = []
  const base = `specifications/${family.name}/${release.major}`

  for (const path of listTreeFiles(repoRoot, release.tag, `${base}/examples`)) {
    if (!path.endsWith('.yaml') && !path.endsWith('.yml')) continue
    const blob = readBlobAtRef(repoRoot, release.tag, path)
    if (blob !== null) subjects.push({ path, source: blob.toString('utf8') })
  }

  const conformance = `conformance/${family.name}/${release.major}`
  for (const path of listTreeFiles(repoRoot, release.tag, conformance)) {
    if (!path.endsWith('/metadata.json')) continue
    const blob = readBlobAtRef(repoRoot, release.tag, path)
    if (blob === null) continue

    let metadata: Json
    try {
      metadata = JSON.parse(blob.toString('utf8')) as Json
    } catch {
      continue
    }
    if (!isObject(metadata) || metadata.expected !== 'pass') continue

    const dir = path.slice(0, -'/metadata.json'.length)
    // A tree case names its document inside `tree/`; a flat case is `case.yaml`.
    const document =
      typeof metadata.document === 'string'
        ? `${dir}/tree/${metadata.document}`
        : `${dir}/case.yaml`
    const source = readBlobAtRef(repoRoot, release.tag, document)
    if (source !== null) subjects.push({ path: document, source: source.toString('utf8') })
  }

  return subjects
}

/**
 * Replay one release's accepted documents against the current bundle.
 *
 * Parser and structural only. A semantic rule is decided against the item the
 * document sits in, and a fixture's surroundings are not reconstructed here —
 * `check:conformance` is what exercises those. Structural is where "validation
 * became stricter" actually shows up: a narrowed enum, a tightened pattern, a
 * newly required field.
 */
export function replayRelease(
  repoRoot: string,
  family: Family,
  release: Release,
  failures: Failures,
): number {
  const validate = compileFamily(family)
  const subjects = subjectsAt(repoRoot, family, release)

  for (const subject of subjects) {
    const parsed = parseDocument(subject.source)
    if ('errors' in parsed) {
      failures.add(
        `${release.tag} accepted ${subject.path}, but the candidate parser rejects it — ` +
          `${parsed.errors.map((e) => e.code).join(', ')}. Validation became stricter inside ` +
          'a major version.',
      )
      continue
    }
    if (validate(parsed.value) as boolean) continue
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ')
    failures.add(
      `${release.tag} accepted ${subject.path}, but the candidate schema rejects it — ` +
        `${detail}. Validation became stricter inside a major version.`,
    )
  }

  return subjects.length
}

function main(): void {
  const failures = new Failures()
  const releases = discoverReleases(REPO_ROOT)
  const families = new Map(discoverFamilies().map((f) => [`${f.name}/${f.major}`, f]))

  let replayed = 0
  let checked = 0

  for (const release of releases) {
    const family = families.get(`${release.family}/${release.major}`)
    if (family === undefined) {
      // A retired family still has published versions, but no current schema to
      // replay them against. Say so rather than counting it as clean.
      console.log(`  · ${release.tag}: no ${release.family}/${release.major} in the working tree`)
      continue
    }
    const count = replayRelease(REPO_ROOT, family, release, failures)
    console.log(`  ✓ ${release.tag}: ${count} document(s) replayed`)
    replayed += count
    checked += 1
  }

  failures.report(
    checked === 0
      ? 'No releases to replay yet — the compatibility guarantee starts at the first tag.'
      : `Replayed ${replayed} document(s) from ${checked} release(s); none regressed.`,
  )
}

if (import.meta.main) main()
