/**
 * The core gate: a kind family release waits for core's releasable changes
 * (docs/adr/0022 §7, docs/adr/0023 §5).
 *
 * A kind family release records `requires.core`, the core edition it was built
 * and tested against, and ships that edition's prose and corpus. If core carries
 * a releasable change that edition does not include, the record would name
 * rules the family was not tested against. So:
 *
 *   pending   core's manifest must have released; `core/v<requires.core>` must
 *             exist; and no releasable commit may touch core since that tag.
 *             A non-releasable core commit warns — release-please opens no core
 *             release for it, so blocking would deadlock every kind family on
 *             the one change that alters no rule.
 *   tagged    `core/v<requires.core>` must be an ancestor of the family tag.
 *             That is all `check:published` asks of history. `release:stage`,
 *             on the tag's own tooling, also requires no releasable core commit
 *             between them and its major to be the core line the family's §2
 *             cites — classification is never re-run by newer tooling.
 *
 * A commit is releasable when its type is one release-please's changelog shows,
 * read from the same configuration release-please reads, when it is breaking,
 * or when its trailer block carries `Release-As:`.
 * The gate reads `git log`, not a pull request body, so a
 * `BEGIN_COMMIT_OVERRIDE` is invisible to it; ADR 0023 §5 makes not using one on
 * core a review obligation.
 *
 * `bun core-gate.ts` is `task check:editions`.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readFileSync } from 'node:fs'
import { BindingsError, parseBindings } from '../lib/bindings.ts'
import { isAncestor, type LogEntry, logRange, readBlobAtRef, tagExists } from '../lib/git.ts'
import {
  CORE_FAMILY,
  Failures,
  familyPaths,
  inRepo,
  isObject,
  type Json,
  parseManifestKey,
  RELEASE_PLEASE_CONFIG_FILE,
  RELEASE_PLEASE_MANIFEST_FILE,
  REPO_ROOT,
  releaseDirPaths,
} from '../lib/layout.ts'
import { readLedger } from './ledger.ts'
import {
  compareVersions,
  isCore,
  parseReleaseTag,
  readManifest,
  releaseTag,
  UNRELEASED_VERSION,
} from './releases.ts'

export type CommitClass = 'releasable' | 'non-releasable'

export interface ClassifiedCommit extends LogEntry {
  readonly class: CommitClass
}

/** release-please's own visible sections, when a config names none. */
const DEFAULT_VISIBLE_TYPES = ['feat', 'fix', 'perf', 'revert']

/**
 * The commit types whose changelog section is visible — the types that make
 * release-please open a release.
 */
export function releasableTypes(repoRoot: string): ReadonlySet<string> {
  const path = inRepo(repoRoot, RELEASE_PLEASE_CONFIG_FILE)
  if (!existsSync(path)) {
    throw new Error(
      `${RELEASE_PLEASE_CONFIG_FILE} is missing. The core gate classifies commits by the ` +
        'changelog sections release-please reads there.',
    )
  }
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Json
  if (!isObject(doc)) throw new Error(`${RELEASE_PLEASE_CONFIG_FILE}: expected an object`)
  const sections = doc['changelog-sections']
  if (sections === undefined) return new Set(DEFAULT_VISIBLE_TYPES)
  if (!Array.isArray(sections)) {
    throw new Error(`${RELEASE_PLEASE_CONFIG_FILE}: "changelog-sections" must be an array`)
  }
  const types = new Set<string>()
  for (const section of sections) {
    if (!isObject(section) || typeof section.type !== 'string') {
      throw new Error(`${RELEASE_PLEASE_CONFIG_FILE}: every changelog section needs a "type"`)
    }
    if (section.hidden !== true) types.add(section.type)
  }
  return types
}

const HEADER = /^(?<type>[A-Za-z]+)(?:\([^()\r\n]*\))?(?<bang>!)?: \S/

/**
 * A trailer line, as git reads one: a token of letters, digits and hyphens,
 * then `: ` or ` #`. `BREAKING CHANGE` is the one token with a space, which
 * Conventional Commits adds to git's grammar.
 */
const TRAILER = /^(?<token>BREAKING CHANGE|[A-Za-z0-9-]+)(?::\s|\s#)/
/** Trailers git itself writes, which let a block that also holds prose count. */
const GIT_GENERATED = /^(?:Signed-off-by: |\(cherry picked from commit )/

/**
 * The tokens of a body's trailer block, by git's rules: the last paragraph, in
 * which every line is a trailer or an indented continuation of one — or, when
 * it carries a trailer git generates, at least a quarter of its lines are
 * trailers. A token mentioned anywhere else is prose.
 */
export function trailerTokens(body: string): string[] {
  const paragraphs = body
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/^\n+|\s+$/g, ''))
    .filter((paragraph) => paragraph !== '')
  const last = paragraphs[paragraphs.length - 1]
  if (last === undefined) return []
  const tokens: string[] = []
  let trailers = 0
  let prose = 0
  let generated = false
  let previousWasTrailer = false
  for (const line of last.split('\n')) {
    if (/^\s/.test(line) && previousWasTrailer) continue
    const match = TRAILER.exec(line)
    if (match?.groups?.token !== undefined) {
      tokens.push(match.groups.token)
      trailers += 1
      previousWasTrailer = true
      if (GIT_GENERATED.test(line)) generated = true
    } else {
      prose += 1
      previousWasTrailer = false
    }
  }
  if (trailers === 0) return []
  if (prose === 0 || (generated && trailers * 3 >= prose)) return tokens
  return []
}

/**
 * Whether a commit would make release-please release.
 *
 * Breaking is `!` after the type or scope, or a `BREAKING CHANGE:` or
 * `BREAKING-CHANGE:` footer in the trailer block. A `Release-As:` footer forces
 * a release whatever the type. A subject that is not a conventional header is
 * never releasable: release-please cannot parse it, so it releases nothing.
 */
export function classifyCommit(
  subject: string,
  body: string,
  types: ReadonlySet<string> = releasableTypes(REPO_ROOT),
): CommitClass {
  const header = HEADER.exec(subject)
  const type = header?.groups?.type
  if (type === undefined) return 'non-releasable'
  if (header?.groups?.bang === '!') return 'releasable'
  for (const token of trailerTokens(body)) {
    if (token === 'BREAKING CHANGE' || token === 'BREAKING-CHANGE') return 'releasable'
    if (token.toLowerCase() === 'release-as') return 'releasable'
  }
  return types.has(type) ? 'releasable' : 'non-releasable'
}

/** The core line a core version belongs to, e.g. `1.2.0` → `v1`. */
function lineOf(version: string): string {
  return `v${version.split('.')[0]}`
}

/**
 * The non-merge commits in `from..to` that touch a core line, classified.
 * A releasable commit anywhere else does not count.
 */
export function coreCommitsBetween(
  repoRoot: string,
  from: string,
  to: string,
  options: { readonly types?: ReadonlySet<string>; readonly line?: string } = {},
): ClassifiedCommit[] {
  const types = options.types ?? releasableTypes(repoRoot)
  const dir = familyPaths(CORE_FAMILY, options.line ?? 'v1').dir
  return logRange(repoRoot, from, to, dir).map((commit) => ({
    ...commit,
    class: classifyCommit(commit.subject, commit.body, types),
  }))
}

function describe(commits: readonly ClassifiedCommit[]): string {
  return commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`).join('; ')
}

/**
 * The core line a kind family's §2 cites, or null with a failure added.
 * `label` names the spec in the message.
 */
export function citedCoreLine(markdown: string, label: string, failures: Failures): string | null {
  let bindings: ReturnType<typeof parseBindings>
  try {
    bindings = parseBindings(markdown)
  } catch (error) {
    if (!(error instanceof BindingsError)) throw error
    failures.add(`${label} §2: ${error.message}`)
    return null
  }
  const line = bindings?.dependencies.find((d) => d.family === CORE_FAMILY)?.line
  if (line === undefined) {
    failures.add(
      `${label} §2 cites no core line in its "Normative dependencies" table, so the core ` +
        'edition a release requires cannot be checked against it.',
    )
    return null
  }
  return line
}

/** A kind family release recorded, or about to be, and not yet tagged. */
export interface PendingKindRelease {
  readonly tag: string
  /** The family version directory, which is also its manifest key. */
  readonly path: string
  readonly requiresCore: string
}

/** The ledger's untagged kind family entries. */
export function pendingKindReleases(repoRoot: string): PendingKindRelease[] {
  const pending: PendingKindRelease[] = []
  for (const [tag, entry] of Object.entries(readLedger(repoRoot).releases)) {
    const release = parseReleaseTag(tag)
    if (release === null || isCore(release.family) || entry.requires === undefined) continue
    if (tagExists(repoRoot, tag)) continue
    pending.push({ tag, path: entry.path, requiresCore: entry.requires.core })
  }
  return pending.sort((a, b) => a.tag.localeCompare(b.tag))
}

/**
 * The core version a kind family at `path` would record now: the manifest
 * version of the core line its working-tree §2 cites. Null when it cites none;
 * `assertCoreGatePending` reports why.
 */
export function coreManifestVersionFor(repoRoot: string, path: string): string | null {
  const spec = inRepo(repoRoot, releaseDirPaths(path).spec)
  if (!existsSync(spec)) return null
  const line = citedCoreLine(readFileSync(spec, 'utf8'), path, new Failures())
  if (line === null) return null
  return readManifest(repoRoot)[familyPaths(CORE_FAMILY, line).manifestKey] ?? UNRELEASED_VERSION
}

/**
 * The gate for pending kind family releases, against HEAD. Defaults to the
 * ledger's untagged entries; `record` passes the entries it is about to write.
 */
export function assertCoreGatePending(
  repoRoot: string,
  failures: Failures,
  warnings: string[],
  pending: readonly PendingKindRelease[] = pendingKindReleases(repoRoot),
): void {
  if (pending.length === 0) return
  const types = releasableTypes(repoRoot)
  const manifest = readManifest(repoRoot)

  for (const release of pending) {
    const { tag, path, requiresCore } = release
    const specPath = releaseDirPaths(path).spec
    const absolute = inRepo(repoRoot, specPath)
    if (!existsSync(absolute)) {
      failures.add(`${tag}: ${specPath} does not exist, so it cites no core line`)
      continue
    }
    const line = citedCoreLine(readFileSync(absolute, 'utf8'), specPath, failures)
    if (line === null) continue

    const coreKey = familyPaths(CORE_FAMILY, line).manifestKey
    const manifestVersion = manifest[coreKey]
    if (manifestVersion === undefined || manifestVersion === UNRELEASED_VERSION) {
      failures.add(
        `${tag}: core ${line} has never been released — ${RELEASE_PLEASE_MANIFEST_FILE} reads ` +
          `${manifestVersion ?? '<absent>'} for ${coreKey}. A kind family release records the ` +
          'core edition it was built against, so core releases first.',
      )
      continue
    }
    if (lineOf(requiresCore) !== line) {
      failures.add(
        `${tag}: requires core ${requiresCore}, but ${specPath} §2 cites core ${line}. ` +
          'Re-run `task release:record`.',
      )
      continue
    }
    const order = compareVersions(requiresCore, manifestVersion)
    if (order > 0) {
      failures.add(
        `${tag}: requires core ${requiresCore}, which ${RELEASE_PLEASE_MANIFEST_FILE} has not ` +
          `reached (${manifestVersion}). Re-run \`task release:record\`.`,
      )
      continue
    }
    if (order < 0) {
      warnings.push(
        `${tag}: requires core ${requiresCore}, which trails core's manifest version ` +
          `${manifestVersion}. Re-run \`task release:record\` to build against the newer edition.`,
      )
    }

    const coreTag = releaseTag(CORE_FAMILY, requiresCore)
    if (!tagExists(repoRoot, coreTag)) {
      failures.add(
        `${tag}: requires core ${requiresCore}, but ${coreTag} does not exist. ` +
          "Merge core's release pull request first, then update this branch.",
      )
      continue
    }
    const commits = coreCommitsBetween(repoRoot, coreTag, 'HEAD', { types, line })
    const releasable = commits.filter((c) => c.class === 'releasable')
    const other = commits.filter((c) => c.class === 'non-releasable')
    if (releasable.length > 0) {
      failures.add(
        `${tag}: core carries ${releasable.length} releasable commit(s) since ${coreTag} — ` +
          `${describe(releasable)}. Release core first, so this release records the edition ` +
          'it is tested against.',
      )
    }
    if (other.length > 0) {
      warnings.push(
        `${tag}: core carries ${other.length} non-releasable commit(s) since ${coreTag} — ` +
          `${describe(other)}. They change no rule, so they do not block.`,
      )
    }
  }
}

/**
 * The gate for a tagged kind family release, as `check:published` runs it on
 * history: `core/v<requires.core>` must exist and be an ancestor of the family
 * tag. Nothing is reclassified — which commits are releasable was decided by
 * the tooling and configuration of the release itself (`release:stage`), and a
 * later change to either must not turn a published release red.
 */
export function assertCoreGateTagged(
  repoRoot: string,
  familyTag: string,
  coreVersion: string,
  failures: Failures,
): void {
  const release = parseReleaseTag(familyTag)
  if (release === null || isCore(release.family)) {
    failures.add(`${familyTag}: not a kind family release tag`)
    return
  }
  const coreTag = releaseTag(CORE_FAMILY, coreVersion)
  if (!tagExists(repoRoot, coreTag)) {
    failures.add(`${familyTag}: requires core ${coreVersion}, but ${coreTag} does not exist`)
    return
  }
  if (!isAncestor(repoRoot, coreTag, familyTag)) {
    failures.add(
      `${familyTag}: requires core ${coreVersion}, but ${coreTag} is not an ancestor of it — ` +
        'the release was not built on that edition.',
    )
  }
}

/**
 * The whole tagged gate, as `release:stage` runs it with the tag's own
 * tooling: ancestry, no releasable core commit between the core tag and the
 * family tag, and `requires.core`'s major matching the core line the family's
 * §2 cites at the tag. `path` is the ledger's; it defaults to where the layout
 * keeps the family today.
 */
export function assertCoreGateTaggedContent(
  repoRoot: string,
  familyTag: string,
  coreVersion: string,
  failures: Failures,
  path?: string,
): void {
  const before = failures.count
  assertCoreGateTagged(repoRoot, familyTag, coreVersion, failures)
  if (failures.count > before) return
  const release = parseReleaseTag(familyTag) as NonNullable<ReturnType<typeof parseReleaseTag>>
  const coreTag = releaseTag(CORE_FAMILY, coreVersion)
  const line = lineOf(coreVersion)
  const releasable = coreCommitsBetween(repoRoot, coreTag, familyTag, { line }).filter(
    (c) => c.class === 'releasable',
  )
  if (releasable.length > 0) {
    failures.add(
      `${familyTag}: core carries ${releasable.length} releasable commit(s) between ${coreTag} ` +
        `and the release — ${describe(releasable)}.`,
    )
  }
  const specPath = releaseDirPaths(path ?? familyPaths(release.family, release.major).dir).spec
  const spec = readBlobAtRef(repoRoot, familyTag, specPath)
  if (spec === null) {
    failures.add(`${familyTag}: ${specPath} does not exist at that tag`)
    return
  }
  const cited = citedCoreLine(spec.toString('utf8'), `${familyTag}:${specPath}`, failures)
  if (cited !== null && cited !== line) {
    failures.add(
      `${familyTag}: requires core ${coreVersion}, a core ${line} edition, but its §2 cites ` +
        `core ${cited}.`,
    )
  }
}

function main(): void {
  const failures = new Failures()
  const warnings: string[] = []

  // Where core stands, so a reader of a kind family's release pull request can
  // see what the gate is measuring against.
  const manifest = readManifest(REPO_ROOT)
  for (const [key, version] of Object.entries(manifest)) {
    if (parseManifestKey(key)?.name !== CORE_FAMILY) continue
    if (version === UNRELEASED_VERSION) {
      console.log(`  · ${key}: never released`)
      continue
    }
    const coreTag = releaseTag(CORE_FAMILY, version)
    if (!tagExists(REPO_ROOT, coreTag)) {
      console.log(`  · ${key}: manifest reads ${version}; ${coreTag} is not present`)
      continue
    }
    const commits = coreCommitsBetween(REPO_ROOT, coreTag, 'HEAD', { line: lineOf(version) })
    const releasable = commits.filter((c) => c.class === 'releasable').length
    console.log(
      `  · ${key}: ${coreTag}, then ${releasable} releasable and ` +
        `${commits.length - releasable} non-releasable commit(s)`,
    )
  }

  const pending = pendingKindReleases(REPO_ROOT)
  assertCoreGatePending(REPO_ROOT, failures, warnings, pending)
  for (const warning of warnings) console.log(`  ! ${warning}`)
  failures.report(
    pending.length === 0
      ? 'No kind family release is pending — nothing to gate.'
      : `The core gate passes for ${pending.length} pending release(s).`,
  )
}

if (import.meta.main) main()
