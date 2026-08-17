/**
 * What this repository has actually published, and how to read it back.
 *
 * A release is a tag. The tag is the byte source for every pinned URL, because
 * the tag is the only artifact whose immutability is enforced by something
 * outside CI — `.github/rulesets/release-tags.json` blocks deletion, update,
 * and non-fast-forward server-side. The working tree is not a source of truth
 * for anything already released.
 *
 * `published.json` is the ledger beside it. It answers three questions git
 * alone cannot:
 *
 *   1. Presence. Without it, "the tags were never fetched" and "nothing has
 *      been released" look identical, and the difference is a silent 404 on
 *      every pinned URL. With it, a missing tag is a build failure.
 *   2. Where the bytes lived. `path` is recorded per release, so restructuring
 *      `schemas/dist/` later never breaks the history — the ledger remembers
 *      the layout of each epoch.
 *   3. A reviewable record. The set of things this repository can never take
 *      back appears in a diff, under CODEOWNERS.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, isEmptyRepository, isShallow, listTags, readBlobAtRef, tagCommit } from './git.ts'
import {
  canonicalJson,
  type Failures,
  isObject,
  type Json,
  readJson,
  SCHEMA_ORIGIN,
} from './spec.ts'

/** Release tags are `<family>/v<MAJOR>.<MINOR>.<PATCH>` and nothing else. */
const RELEASE_TAG = /^(?<family>[a-z][a-z0-9-]*)\/v(?<version>\d+\.\d+\.\d+)$/

export const LEDGER_FILE = 'published.json'
export const MANIFEST_FILE = join('.github', 'release-please', 'manifest.json')

export interface Release {
  /** The tag verbatim, e.g. `component/v1.2.0`. */
  readonly tag: string
  readonly family: string
  /** Major-version directory the release belongs to, e.g. `v1`. */
  readonly major: string
  /** Exact version without the `v`, e.g. `1.2.0`. */
  readonly version: string
}

export interface LedgerEntry {
  /** Repo-relative path the bundle occupied in this release's commit. */
  readonly path: string
  /** SHA-256 of the bytes stored at that path — what the tag holds. */
  readonly sourceSha256: string
  /** SHA-256 of the bytes served at the pinned URL, after `$id` is stamped. */
  readonly publishedSha256: string
}

export interface Ledger {
  readonly version: 1
  readonly releases: { [tag: string]: LedgerEntry }
}

export const EMPTY_LEDGER: Ledger = { version: 1, releases: {} }

export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Parse a tag into a release, or null when it is not one of ours. */
export function parseReleaseTag(tag: string): Release | null {
  const match = RELEASE_TAG.exec(tag)
  const family = match?.groups?.family
  const version = match?.groups?.version
  if (family === undefined || version === undefined) return null
  return { tag, family, major: `v${version.split('.')[0]}`, version }
}

/** Where a family's bundle lives by default — the layout in use today. */
export function defaultBundlePath(family: string, major: string): string {
  return join('specifications', family, major, 'schemas', 'dist', `${family}.schema.json`)
}

/** The URL a pinned release is served from, and its own canonical `$id`. */
export function pinnedUrl(release: Release): string {
  return `${SCHEMA_ORIGIN}/${release.family}/v${release.version}/${release.family}.schema.json`
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Every release this repository has tagged, oldest first.
 *
 * Deliberately not routed through `discoverFamilies()`. A family retired from
 * the working tree must keep serving the versions it published — deleting a
 * directory is not a way to unpublish, and it must not silently become one.
 */
export function discoverReleases(repoRoot: string): Release[] {
  if (isEmptyRepository(repoRoot)) return []
  const releases: Release[] = []
  for (const tag of listTags(repoRoot)) {
    const release = parseReleaseTag(tag)
    if (release === null) continue
    releases.push(release)
  }
  return releases.sort(
    (a, b) => a.family.localeCompare(b.family) || compareVersions(a.version, b.version),
  )
}

export function readLedger(repoRoot: string): Ledger {
  const path = join(repoRoot, LEDGER_FILE)
  if (!existsSync(path)) return EMPTY_LEDGER
  const doc = readJson(path)
  if (!isObject(doc) || !isObject(doc.releases)) {
    throw new Error(`${LEDGER_FILE}: expected { "version": 1, "releases": { … } }`)
  }
  const releases: { [tag: string]: LedgerEntry } = {}
  for (const [tag, value] of Object.entries(doc.releases)) {
    if (
      !isObject(value) ||
      typeof value.path !== 'string' ||
      typeof value.sourceSha256 !== 'string' ||
      typeof value.publishedSha256 !== 'string'
    ) {
      throw new Error(
        `${LEDGER_FILE}: releases/${tag} must carry "path", "sourceSha256", and "publishedSha256"`,
      )
    }
    releases[tag] = {
      path: value.path,
      sourceSha256: value.sourceSha256,
      publishedSha256: value.publishedSha256,
    }
  }
  return { version: 1, releases }
}

export function serializeLedger(ledger: Ledger): string {
  const releases: { [tag: string]: Json } = {}
  for (const tag of Object.keys(ledger.releases).sort()) {
    const entry = ledger.releases[tag] as LedgerEntry
    releases[tag] = {
      path: entry.path,
      sourceSha256: entry.sourceSha256,
      publishedSha256: entry.publishedSha256,
    }
  }
  return canonicalJson({ version: 1, releases })
}

/**
 * The path a release's bundle occupied.
 *
 * The ledger wins. The default is only for a release the ledger has not yet
 * recorded, which is the pre-merge state of a release pull request.
 */
export function resolveBundlePath(release: Release, ledger: Ledger): string {
  return ledger.releases[release.tag]?.path ?? defaultBundlePath(release.family, release.major)
}

/**
 * Stamp a pinned copy with its own identity.
 *
 * The committed bundle's `$id` is the moving alias, because that is the URL the
 * alias serves. Copying those bytes to a pinned path unchanged would give every
 * release the same canonical identity as the alias and as each other, so a
 * validator that resolves or caches by `$id` could not tell two releases apart
 * — which is the entire point of pinning. One released version, one identity.
 */
export function stampPinnedId(source: Buffer, release: Release): string {
  const doc = JSON.parse(source.toString('utf8')) as Json
  if (!isObject(doc)) {
    throw new Error(`${release.tag}: bundle root must be an object`)
  }
  return canonicalJson({ ...doc, $id: pinnedUrl(release) })
}

export interface LoadedRelease {
  readonly release: Release
  readonly path: string
  readonly source: Buffer
  readonly sourceSha256: string
  readonly published: string
  readonly publishedSha256: string
}

/** Read a release's bundle out of its tag and derive what gets served. */
export function loadRelease(repoRoot: string, release: Release, ledger: Ledger): LoadedRelease {
  const path = resolveBundlePath(release, ledger)
  const source = readBlobAtRef(repoRoot, release.tag, path)
  if (source === null) {
    throw new Error(
      `${release.tag}: no bundle at ${path}. If the layout changed after this ` +
        `release, record the path it used in ${LEDGER_FILE}.`,
    )
  }
  const published = stampPinnedId(source, release)
  return {
    release,
    path,
    source,
    sourceSha256: sha256(source),
    published,
    publishedSha256: sha256(published),
  }
}

function readManifest(repoRoot: string): { [k: string]: string } {
  const path = join(repoRoot, MANIFEST_FILE)
  if (!existsSync(path)) return {}
  const doc = readJson(path)
  if (!isObject(doc)) return {}
  const out: { [k: string]: string } = {}
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

function manifestKeyFor(release: Release): string {
  return `specifications/${release.family}/${release.major}`
}

/**
 * Cross-check the ledger, the tags, and the release-please manifest.
 *
 * The three states that matter:
 *
 *   entry + tag     the tag's bytes must still hash to what was recorded
 *   entry, no tag   a release pull request mid-flight: the manifest must name
 *                   that version and the working tree must hold those bytes.
 *                   This is what validates a release before it is tagged.
 *   tag, no entry   a tag created outside the release flow, or one that was
 *                   rewritten. Always a failure.
 */
export function verifyPublications(repoRoot: string, failures: Failures): void {
  if (isEmptyRepository(repoRoot)) return

  const ledger = readLedger(repoRoot)
  const releases = discoverReleases(repoRoot)
  const tagged = new Map(releases.map((r) => [r.tag, r]))
  const manifest = readManifest(repoRoot)

  if (Object.keys(ledger.releases).length > 0 && releases.length === 0 && isShallow(repoRoot)) {
    failures.add(
      `${LEDGER_FILE} records ${Object.keys(ledger.releases).length} release(s) but this ` +
        'is a shallow clone with no tags. Run `git fetch --tags --unshallow` — publishing ' +
        'from here would drop every pinned version.',
    )
    return
  }

  for (const [tag, entry] of Object.entries(ledger.releases)) {
    const release = tagged.get(tag)
    if (release === undefined) {
      const pending = parseReleaseTag(tag)
      if (pending === null) {
        failures.add(`${LEDGER_FILE}: "${tag}" is not a release tag`)
        continue
      }
      // Pending release. The tag does not exist yet, so the working tree is the
      // only place the bytes can be, and the manifest is what says they are the
      // ones about to be tagged.
      const declared = manifest[manifestKeyFor(pending)]
      if (declared !== pending.version) {
        failures.add(
          `${LEDGER_FILE}: ${tag} has no tag and ${MANIFEST_FILE} reads ` +
            `${declared ?? '<absent>'} for ${manifestKeyFor(pending)}. A ledger entry ` +
            'without a tag is only valid while its release is pending.',
        )
        continue
      }
      const working = join(repoRoot, entry.path)
      if (!existsSync(working)) {
        failures.add(`${LEDGER_FILE}: ${tag} records ${entry.path}, which does not exist`)
        continue
      }
      const actual = sha256(readFileSync(working))
      if (actual !== entry.sourceSha256) {
        failures.add(
          `${LEDGER_FILE}: ${tag} records sourceSha256 ${entry.sourceSha256} but ` +
            `${entry.path} hashes to ${actual}. Re-run \`task ledger:record\`.`,
        )
      }
      continue
    }

    const source = readBlobAtRef(repoRoot, tag, entry.path)
    if (source === null) {
      failures.add(`${tag}: ${entry.path} does not exist at that tag`)
      continue
    }
    const actual = sha256(source)
    if (actual !== entry.sourceSha256) {
      failures.add(
        `${tag}: ${entry.path} hashes to ${actual}, but ${LEDGER_FILE} records ` +
          `${entry.sourceSha256}. A released version has been altered — the tag was ` +
          'rewritten, or the ledger was edited.',
      )
      continue
    }
    const publishedSha = sha256(stampPinnedId(source, release))
    if (publishedSha !== entry.publishedSha256) {
      failures.add(
        `${tag}: the published bytes now hash to ${publishedSha}, but ${LEDGER_FILE} ` +
          `records ${entry.publishedSha256}. The way pinned copies are derived has ` +
          'changed, which would silently alter an immutable URL.',
      )
    }
  }

  for (const release of releases) {
    if (ledger.releases[release.tag] !== undefined) continue
    failures.add(
      `${release.tag} is tagged but absent from ${LEDGER_FILE}. Every published ` +
        'version must be recorded before it can be served — run `task ledger:sync` ' +
        'if this tag is legitimate.',
    )
  }
}

/** A manifest version that is neither tagged nor recorded — worth saying, not failing. */
export function pendingNotices(repoRoot: string): string[] {
  if (isEmptyRepository(repoRoot)) return []
  const ledger = readLedger(repoRoot)
  const tags = new Set(discoverReleases(repoRoot).map((r) => r.tag))
  const notices: string[] = []
  for (const [key, version] of Object.entries(readManifest(repoRoot))) {
    if (version === '0.0.0') continue
    const parts = key.split('/')
    const family = parts[1]
    if (family === undefined) continue
    const tag = `${family}/v${version}`
    if (tags.has(tag) || ledger.releases[tag] !== undefined) continue
    notices.push(`${key} reads ${version}, which is neither tagged nor recorded yet`)
  }
  return notices
}

/** Guard that a tag points at the commit the workflow is building. */
export function assertTagAtCommit(repoRoot: string, tag: string, commit: string): void {
  const actual = tagCommit(repoRoot, tag)
  if (actual !== commit) {
    throw new Error(`${tag} points at ${actual}, not ${commit}`)
  }
  git(repoRoot, ['rev-parse', '--verify', `refs/tags/${tag}`])
}
