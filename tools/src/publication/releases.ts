/**
 * What a release is called, where it is served, and the identity it carries.
 *
 * A release is a tag, `<family>/v<MAJOR>.<MINOR>.<PATCH>`, and nothing else is.
 * Its bytes are the immutable GitHub release asset attached to that tag, which
 * `published.json` pins by hash (docs/adr/0023); this module holds only the
 * naming both sides agree on.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isEmptyRepository, listTags } from '../lib/git.ts'
import {
  bundleUrl,
  CORE_FAMILY,
  canonicalJson,
  inRepo,
  isObject,
  type Json,
  RELEASE_PLEASE_MANIFEST_FILE,
  readJson,
} from '../lib/layout.ts'

/**
 * release-please's manifest: package directory to the version it last released
 * or, on a release pull request, is about to. `0.0.0` means never released.
 */
export function readManifest(repoRoot: string): { readonly [dir: string]: string } {
  const path = inRepo(repoRoot, RELEASE_PLEASE_MANIFEST_FILE)
  if (!existsSync(path)) return {}
  const doc = readJson(path)
  if (!isObject(doc)) throw new Error(`${RELEASE_PLEASE_MANIFEST_FILE}: expected an object`)
  const out: { [dir: string]: string } = {}
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value !== 'string') {
      throw new Error(`${RELEASE_PLEASE_MANIFEST_FILE}: ${key} must map to a version string`)
    }
    out[key] = value
  }
  return out
}

/** The placeholder a manifest carries for a package that has never released. */
export const UNRELEASED_VERSION = '0.0.0'

/** Release tags are `<family>/v<MAJOR>.<MINOR>.<PATCH>` and nothing else. */
const RELEASE_TAG = /^(?<family>[a-z][a-z0-9-]*)\/v(?<version>\d+\.\d+\.\d+)$/
const VERSION = /^\d+\.\d+\.\d+$/

export interface Release {
  /** The tag verbatim, e.g. `component/v1.2.0`. */
  readonly tag: string
  readonly family: string
  /** Major-version directory the release belongs to, e.g. `v1`. */
  readonly major: string
  /** Exact version without the `v`, e.g. `1.2.0`. */
  readonly version: string
}

export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Whether a string is an exact `X.Y.Z` version. */
export function isVersion(value: string): boolean {
  return VERSION.test(value)
}

/** Parse a tag into a release, or null when it is not one of ours. */
export function parseReleaseTag(tag: string): Release | null {
  const match = RELEASE_TAG.exec(tag)
  const family = match?.groups?.family
  const version = match?.groups?.version
  if (family === undefined || version === undefined) return null
  return { tag, family, major: `v${version.split('.')[0]}`, version }
}

/** The tag a family version is released under. */
export function releaseTag(family: string, version: string): string {
  return `${family}/v${version}`
}

/** Whether a family is the schema-less base family (docs/adr/0022). */
export function isCore(family: string): boolean {
  return family === CORE_FAMILY
}

/** Numeric `X.Y.Z` ordering. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Family name, then version — the order every report and page lists releases in. */
export function compareReleases(a: Release, b: Release): number {
  return a.family.localeCompare(b.family) || compareVersions(a.version, b.version)
}

/**
 * Every release tag in the repository, oldest first within each family.
 *
 * Deliberately not routed through `discoverFamilies()`. A family retired from
 * the working tree still has tags, and a tag with no ledger entry is a failure
 * whether or not the family is still authored.
 */
export function discoverReleases(repoRoot: string): Release[] {
  if (isEmptyRepository(repoRoot)) return []
  const releases: Release[] = []
  for (const tag of listTags(repoRoot)) {
    const release = parseReleaseTag(tag)
    if (release !== null) releases.push(release)
  }
  return releases.sort(compareReleases)
}

/** The URL a release's bundle is served from, and its own canonical `$id`. */
export function pinnedUrl(release: Pick<Release, 'family' | 'version'>): string {
  return bundleUrl(release.family, `v${release.version}`)
}

/** The moving major-version alias URL. */
export function aliasUrl(family: string, major: string): string {
  return bundleUrl(family, major)
}

/** The asset names a release carries, by convention rather than by record. */
export function assetNames(release: Pick<Release, 'family' | 'version'>): {
  readonly bundle: string
  readonly archive: string
} {
  return {
    bundle: `${release.family}.schema.json`,
    archive: `${release.family}-v${release.version}.tar.gz`,
  }
}

/**
 * The same bundle under another identity.
 *
 * A pinned bundle is canonical; the alias a released major serves is its bytes
 * with `$id` restamped (docs/adr/0023 §7). Canonical JSON in, canonical JSON
 * out, so restamping an alias build with its pinned URL gives the pinned build
 * byte for byte, and the reverse.
 */
export function stampId(bytes: Buffer | string, url: string): string {
  const text = typeof bytes === 'string' ? bytes : bytes.toString('utf8')
  const doc = JSON.parse(text) as Json
  if (!isObject(doc)) throw new Error(`cannot stamp ${url}: bundle root must be an object`)
  return canonicalJson({ ...doc, $id: url })
}
