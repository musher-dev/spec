/**
 * Released-version lookup, sourced from the release-please manifest.
 *
 * release-please owns that file, so it is the one place that knows what has
 * actually shipped. Nothing else in the repo should hard-code a version.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Family, isObject, type Json, REPO_ROOT, readJson } from './spec.ts'

const MANIFEST_PATH = join(REPO_ROOT, '.github', 'release-please', 'manifest.json')

/** Manifest key for a family — the release-please package path. */
export function manifestKey(family: Family): string {
  return `specifications/${family.name}/${family.major}`
}

/**
 * The last released version of a family, or null when nothing has shipped.
 *
 * A `0.0.0` entry is the release-please bootstrap placeholder and means "no
 * release yet", not "version zero".
 */
export function releasedVersion(family: Family): string | null {
  if (!existsSync(MANIFEST_PATH)) return null
  const manifest = readJson(MANIFEST_PATH)
  if (!isObject(manifest)) return null

  const value = (manifest as { [k: string]: Json })[manifestKey(family)]
  if (typeof value !== 'string' || value === '0.0.0') return null
  return value
}

/** Guard that a released version agrees with the directory it lives in. */
export function assertMajorMatches(family: Family, version: string): void {
  const major = version.split('.')[0]
  if (`v${major}` !== family.major) {
    throw new Error(
      `${manifestKey(family)}: released version ${version} does not match the ` +
        `${family.major} directory. A major bump requires a new v<N> directory.`,
    )
  }
}
