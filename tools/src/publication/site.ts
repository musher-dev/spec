/**
 * Assemble the publication tree deployed to https://specifications.musher.dev.
 *
 * Two URL shapes per family:
 *
 *   /<family>/v1/<family>.schema.json        moving alias within the major
 *   /<family>/v1.2.0/<family>.schema.json    immutable, published once
 *
 * **Pinned paths are served from verified immutable release assets, never
 * from the working tree and never rebuilt.** Releases are enumerated from
 * `published.json`, and each pinned bundle is read only from what
 * `task site:fetch` verified against its GitHub release and the ledger's
 * `bundleSha256` (docs/adr/0023 §7). A pinned URL neither moves when `main`
 * moves nor disappears when a newer version ships. A released major's alias is
 * its newest pinned bundle with `$id` restamped; the working tree feeds the
 * alias only until the major has its first release.
 *
 * The origin is Cloudflare Pages, so the cache contract is stated here rather
 * than in an edge rule this repository cannot see. `_headers` is generated from
 * the same enumeration that writes the tree — there is no second list of paths
 * to keep in step — and its rules are deliberately non-overlapping, because
 * Pages merges every matching rule and comma-joins duplicate header names
 * rather than letting the more specific one win. `assertNoOverlap` holds that
 * property over the paths actually written, not over the paths someone
 * remembered. See docs/adr/0012.
 *
 * The guarantee that the bytes themselves never change is checked offline by
 * `task check:published` and online by `task site:fetch`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isShallow, listTreeFiles, readBlobAtRef } from '../lib/git.ts'
import {
  CATALOG_NAME,
  CORE_FAMILY,
  canonicalJson,
  discoverFamilies,
  familyPaths,
  hasPart,
  inRepo,
  type Json,
  parseSpecPath,
  RELEASE_CACHE_DIR,
  REPO_ROOT,
  REPO_URL,
  relativeToRepo,
  releaseDirPaths,
  requireFileAtRef,
  requireTreeAtRef,
  SITE_DIR,
  SPECIFICATIONS_ROOT,
} from '../lib/layout.ts'
import { escapeHtml, link, page } from '../render/html.ts'
import { type ProseContext, readOutline, renderProse } from '../render/prose.ts'
import { buildReference, renderReference } from '../render/reference.ts'
import { familyBundle } from '../schema/bundle.ts'
import { buildCatalog } from './catalog.ts'
import { readCachedBundle } from './fetch.ts'
import {
  LEDGER_FILE,
  type RecordedRelease,
  readLedger,
  serializeLedger,
  taggedEntries,
} from './ledger.ts'
import { aliasUrl, discoverReleases, pinnedUrl, sha256, stampId } from './releases.ts'
import { pendingNotices } from './verify.ts'

export interface SiteOptions {
  readonly repoRoot: string
  readonly siteDir: string
  /** Where `site:fetch` cached verified release assets. Defaults to the repository's. */
  readonly cacheDir?: string
}

export interface SiteResult {
  readonly pinned: number
  readonly aliases: number
  readonly pages: number
  readonly reference: number
  readonly rules: number
}

/** One `_headers` block: a path pattern, and the headers it sets on a match. */
export interface HeaderRule {
  /** A Cloudflare Pages source pattern. At most one splat, per their limit. */
  readonly source: string
  readonly headers: readonly string[]
}

const HEADERS_FILE = '_headers'

/**
 * Cloudflare Pages accepts at most 100 rules. Fail at a budget below that: a
 * file over the ceiling is rejected wholesale, and a deploy that silently
 * served every pinned path with the wrong cache policy would look like success.
 */
const MAX_HEADER_RULES = 100
const HEADER_RULE_BUDGET = 90
/** Cloudflare Pages' per-line limit, spacing and header name included. */
const MAX_HEADER_LINE = 2000

/** A pinned path is published once and never changes. Cache it for a year. */
const IMMUTABLE = 'Cache-Control: public, max-age=31536000, immutable'
/** An alias moves on release, and an inventory grows. Revalidate quickly. */
const REVALIDATE = 'Cache-Control: public, max-age=300, must-revalidate'

/**
 * Rules keyed on a path *shape* rather than on one published path.
 *
 * `/*` restates two headers Cloudflare Pages already sends by default. They are
 * pinned rather than inherited because README instructs editors and
 * browser-based validators to fetch these URLs cross-origin: that is a
 * guarantee this repository makes, and a guarantee resting on a vendor default
 * is one that can be withdrawn without a commit here.
 *
 * The three overlap freely with everything below, and with each other, because
 * no rule sets a header name another rule also sets — which is the only
 * property that matters when every match is merged.
 */
const SHAPE_RULES: readonly HeaderRule[] = [
  {
    source: '/*',
    headers: ['Access-Control-Allow-Origin: *', 'X-Content-Type-Options: nosniff'],
  },
  {
    // What json-schema.org serves for the same kind of document.
    source: '/*.schema.json',
    headers: ['Content-Type: application/schema+json; charset=utf-8'],
  },
  {
    // Otherwise served as a download rather than shown.
    source: '/*.sha256',
    headers: ['Content-Type: text/plain; charset=utf-8'],
  },
]

function write(path: string, contents: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

/** `sha256sum` output format, so `sha256sum -c` verifies a download unchanged. */
function checksumFile(hash: string, fileName: string): string {
  return `${hash}  ${fileName}\n`
}

/** The one top-level path a family may not be named after. */
const RESERVED_PATH = 'reference'

/**
 * One rendered reference: a family at a version, and the bytes it describes.
 *
 * The bytes come from the ref the alias serves, never from the working tree,
 * so a released family's page describes its release. That bug is invisible
 * today — with no tags, a working-tree reference would pass every check and
 * start lying on the first release.
 *
 * A family that ships no schema — core — is a prose-only target: `bundle` and
 * `schemaPath` are null, and it renders a specification page and nothing else.
 */
interface ReferenceTarget {
  readonly family: string
  readonly major: string
  /** `v1` for the moving alias, `v1.2.0` for an exact release. */
  readonly version: string
  /** Null for a schema-less family. */
  readonly bundle: string | null
  readonly spec: string | null
  /** The family's validated example documents, at the same ref. */
  readonly examples: readonly ExampleDoc[]
  readonly ref: string
  /** The family version directory at `ref` — the ledger's `path` for a release. */
  readonly dir: string
  /** Null for a schema-less family: it has no schema URL to link. */
  readonly schemaPath: string | null
}

interface ExampleDoc {
  readonly name: string
  readonly body: string
}

interface PublishedVersion {
  readonly version: string
  readonly tag: string
  readonly url: string
  readonly sha256: string
}

/**
 * A schema-less family's major line: the ref its `/reference/<family>/<major>/spec/`
 * page reads, with no schema URL beside it.
 */
interface ProseLine {
  readonly family: string
  readonly major: string
  /** The newest tag in the major, or `main` while the major has no tag. */
  readonly ref: string
  readonly dir: string
}

/** A schema-less family's release: a tag and nothing served under it but prose. */
interface ProseRelease {
  readonly version: string
  readonly tag: string
}

/** A major-version alias, and the ref whose prose it currently corresponds to. */
interface Alias {
  readonly family: string
  readonly major: string
  readonly path: string
  /** The tag the alias serves, or `main` while the major has no tag. */
  readonly ref: string
  readonly dir: string
}

/**
 * Cloudflare Pages' source matching, reduced to what this file emits: a literal
 * path, or a pattern with one greedy splat.
 */
export function matchesSource(source: string, path: string): boolean {
  const splat = source.indexOf('*')
  if (splat === -1) return source === path
  const head = source.slice(0, splat)
  const tail = source.slice(splat + 1)
  return path.length >= head.length + tail.length && path.startsWith(head) && path.endsWith(tail)
}

function headerName(header: string): string {
  return header.slice(0, header.indexOf(':'))
}

/**
 * Fail if two rules that both match a published path set the same header.
 *
 * Pages has no notion of specificity: it applies every matching rule and joins
 * duplicate names with a comma, so a broad pinned-path rule plus a per-alias
 * override does not override anything — it emits
 * `Cache-Control: public, max-age=31536000, immutable, public, max-age=300,
 * must-revalidate` and the alias is cached for a year. This is checked against
 * the paths actually written, so a new artifact cannot quietly acquire a second
 * opinion about how long it may be cached.
 */
function assertNoOverlap(rules: readonly HeaderRule[], paths: readonly string[]): void {
  for (const path of paths) {
    const claimed = new Map<string, string>()
    for (const rule of rules) {
      if (!matchesSource(rule.source, path)) continue
      for (const header of rule.headers) {
        const name = headerName(header)
        const previous = claimed.get(name)
        if (previous !== undefined) {
          throw new Error(
            `${HEADERS_FILE}: ${path} matches both '${previous}' and '${rule.source}', and ` +
              `both set ${name}. Cloudflare Pages merges matching rules and comma-joins ` +
              'duplicate header names, so the result would be neither value.',
          )
        }
        claimed.set(name, rule.source)
      }
    }
  }
}

/** Serialize the rules, enforcing Cloudflare's two structural limits. */
export function renderHeaders(rules: readonly HeaderRule[]): string {
  if (rules.length > HEADER_RULE_BUDGET) {
    throw new Error(
      `${HEADERS_FILE} would carry ${rules.length} rules; the budget is ${HEADER_RULE_BUDGET} ` +
        `and Cloudflare Pages rejects a file over ${MAX_HEADER_RULES}. Collapse a path shape ` +
        'into a directory rule rather than raising the budget to the ceiling.',
    )
  }

  const lines: string[] = []
  for (const rule of rules) {
    if (lines.length > 0) lines.push('')
    lines.push(rule.source)
    for (const header of rule.headers) lines.push(`  ${header}`)
  }

  for (const line of lines) {
    if (line.length > MAX_HEADER_LINE) {
      throw new Error(
        `${HEADERS_FILE}: a line exceeds Cloudflare's ${MAX_HEADER_LINE}-character limit: ` +
          `${line.slice(0, 80)}…`,
      )
    }
  }

  return `${lines.join('\n')}\n`
}

export function assembleSite(options: SiteOptions): SiteResult {
  const { repoRoot, siteDir } = options

  const ledger = readLedger(repoRoot)
  const cacheDir = options.cacheDir ?? inRepo(repoRoot, RELEASE_CACHE_DIR)

  if (
    Object.keys(ledger.releases).length > 0 &&
    discoverReleases(repoRoot).length === 0 &&
    isShallow(repoRoot)
  ) {
    throw new Error(
      `${LEDGER_FILE} records released versions but no tags are present and this is a ` +
        'shallow clone. Run `git fetch --tags --unshallow` — deploying from here would ' +
        'unpublish every pinned version.',
    )
  }

  // `/reference/` is the generated reference's namespace, and `discoverFamilies`
  // accepts any lowercase-kebab directory name. A family called `reference`
  // would publish into it and its pinned `/reference/v1.0.0/*` immutable rule
  // would collide with the namespace on Cache-Control. Refuse by name, so the
  // failure says what is wrong rather than reporting an overlapping splat.
  for (const name of [
    ...discoverFamilies(repoRoot).map((family) => family.name),
    ...Object.keys(ledger.releases).map((tag) => tag.split('/')[0] as string),
  ]) {
    if (name === RESERVED_PATH) {
      throw new Error(
        `${SPECIFICATIONS_ROOT}/${RESERVED_PATH}/ would publish under /${RESERVED_PATH}/, which the ` +
          'generated reference already owns. A family cannot be named after a reserved ' +
          'top-level path. See docs/adr/0017.',
      )
    }
  }

  rmSync(siteDir, { recursive: true, force: true })
  mkdirSync(siteDir, { recursive: true })

  /** Every path served, in URL form. `_headers` is checked against exactly this. */
  const served: string[] = []
  /** Cache-Control rules, one per published path or per pinned release. */
  const cacheRules: HeaderRule[] = []

  const emit = (path: string, contents: string | Buffer): void => {
    write(join(siteDir, ...path.split('/')), contents)
    served.push(`/${path}`)
  }

  // ---------------------------------------------------------------------------
  // Pinned paths, from verified release assets only. Enumerated from the ledger,
  // so a family retired from the working tree keeps serving what it published.
  // ---------------------------------------------------------------------------
  const releases = taggedEntries(repoRoot, ledger)
  const newestByMajor = new Map<string, { recorded: RecordedRelease; pinned: Buffer }>()
  const versionsByFamily = new Map<string, PublishedVersion[]>()
  const references: ReferenceTarget[] = []
  let pinned = 0

  // A schema-less family (core) publishes prose only: no pinned path, no alias,
  // no inventory, and therefore no `_headers` rule. Its releases are tracked
  // apart from the schema families' so none of that can reach it by accident.
  const newestProseByMajor = new Map<string, RecordedRelease>()
  const proseReleasesByFamily = new Map<string, ProseRelease[]>()
  const proseLines: ProseLine[] = []

  /**
   * `spec.md` as it stood at a ref. On `main`, null where the working tree
   * carries none. Every other ref is a released tag, where a missing file means
   * the layout moved and throws rather than publishing a page with no prose.
   */
  const specAt = (family: string, major: string, ref: string, dir: string): string | null => {
    if (ref === 'main') {
      const local = discoverFamilies(repoRoot).find((f) => f.name === family && f.major === major)
      return local !== undefined && existsSync(local.specPath)
        ? readFileSync(local.specPath, 'utf8')
        : null
    }
    // At a tag, under the ledger's `path` — where the release lived then.
    const path = releaseDirPaths(dir).spec
    if (hasPart(family, major, 'spec')) {
      return requireFileAtRef(repoRoot, ref, path, `${family}/${major} spec.md`).toString('utf8')
    }
    return readBlobAtRef(repoRoot, ref, path)?.toString('utf8') ?? null
  }

  /**
   * The example documents as they stood at a ref.
   *
   * `check:examples` validates every one of these against its family's bundle,
   * and its docblock has always said they are "copied verbatim into the
   * documentation site". Until now nothing copied them, so the claim rested on
   * an intention. Reading them at the same ref as the schema is what keeps it
   * true for a released version as well as for `main`.
   */
  const examplesAt = (family: string, major: string, ref: string, dir: string): ExampleDoc[] => {
    const isExample = (path: string): boolean => path.endsWith('.yaml') || path.endsWith('.yml')
    if (ref === 'main') {
      const local = discoverFamilies(repoRoot).find((f) => f.name === family && f.major === major)
      if (local === undefined || !existsSync(local.examplesDir)) return []
      return readdirSync(local.examplesDir)
        .filter(isExample)
        .sort()
        .map((name) => ({ name, body: readFileSync(join(local.examplesDir, name), 'utf8') }))
    }
    const examples = releaseDirPaths(dir).examples
    const files = hasPart(family, major, 'examples')
      ? requireTreeAtRef(repoRoot, ref, examples, `${family}/${major} examples`)
      : listTreeFiles(repoRoot, ref, examples)
    return files
      .filter(isExample)
      .sort()
      .map((path) => {
        const blob = readBlobAtRef(repoRoot, ref, path)
        return {
          name: path.slice(examples.length + 1),
          body: blob === null ? '' : blob.toString('utf8'),
        }
      })
      .filter((example) => example.body !== '')
  }

  for (const recorded of releases) {
    const { release, entry } = recorded
    if (entry.bundleSha256 === null) {
      references.push({
        family: release.family,
        major: release.major,
        version: `v${release.version}`,
        bundle: null,
        spec: specAt(release.family, release.major, release.tag, entry.path),
        examples: [],
        ref: release.tag,
        dir: entry.path,
        schemaPath: null,
      })
      newestProseByMajor.set(`${release.family}/${release.major}`, recorded)
      proseReleasesByFamily.set(release.family, [
        ...(proseReleasesByFamily.get(release.family) ?? []),
        { version: release.version, tag: release.tag },
      ])
      console.log(`  ✓ /${RESERVED_PATH}/${release.family}/v${release.version}/spec/ (prose only)`)
      continue
    }

    const pinnedBytes = readCachedBundle(cacheDir, release.tag, entry.bundleSha256)
    if (pinnedBytes === null) {
      throw new Error(
        `${release.tag}: no verified release asset in ${relativeToRepo(cacheDir)}. Run ` +
          '`task site:fetch` — a pinned path is served only from bytes verified against its ' +
          `immutable GitHub release and ${LEDGER_FILE}.`,
      )
    }
    const fileName = `${release.family}.schema.json`
    const dir = `${release.family}/v${release.version}`

    emit(`${dir}/${fileName}`, pinnedBytes)
    // Computed from the verified bytes, not copied from the ledger.
    emit(`${dir}/${fileName}.sha256`, checksumFile(sha256(pinnedBytes), fileName))
    // One rule for the release, not one per file: the sidecar is as immutable
    // as the bytes it attests, and a directory rule says so in half the budget.
    cacheRules.push({ source: `/${dir}/*`, headers: [IMMUTABLE] })
    console.log(`  ✓ /${dir}/${fileName} (immutable)`)
    pinned += 1

    references.push({
      family: release.family,
      major: release.major,
      version: `v${release.version}`,
      // The verified bytes this path serves; prose and examples at the tag.
      bundle: pinnedBytes.toString('utf8'),
      spec: specAt(release.family, release.major, release.tag, entry.path),
      examples: examplesAt(release.family, release.major, release.tag, entry.path),
      ref: release.tag,
      dir: entry.path,
      schemaPath: `/${dir}/${fileName}`,
    })

    // `releases` is sorted oldest-first, so the last write per major wins.
    newestByMajor.set(`${release.family}/${release.major}`, { recorded, pinned: pinnedBytes })
    versionsByFamily.set(release.family, [
      ...(versionsByFamily.get(release.family) ?? []),
      {
        version: release.version,
        tag: release.tag,
        url: pinnedUrl(release),
        sha256: entry.bundleSha256,
      },
    ])
  }

  // ---------------------------------------------------------------------------
  // Aliases. A major that has released serves its newest release; one that has
  // not serves the working tree, which is what this repository publishes before
  // its first tag — so nothing regresses pre-release, and the alias stops
  // tracking `main` automatically the moment a family is tagged.
  // ---------------------------------------------------------------------------
  const aliases: Alias[] = []

  const writeAlias = (
    family: string,
    major: string,
    contents: string,
    ref: string,
    origin: string,
    dir: string,
  ): void => {
    const path = `${family}/${major}/${family}.schema.json`
    emit(path, contents)
    cacheRules.push({ source: `/${path}`, headers: [REVALIDATE] })
    aliases.push({ family, major, path: `/${path}`, ref, dir })
    references.push({
      family,
      major,
      version: major,
      bundle: contents,
      spec: specAt(family, major, ref, dir),
      examples: examplesAt(family, major, ref, dir),
      ref,
      dir,
      schemaPath: `/${path}`,
    })
    console.log(`  ✓ /${path} (alias → ${origin})`)
  }

  for (const [key, { recorded, pinned: bytes }] of newestByMajor) {
    const [family, major] = key.split('/') as [string, string]
    // The newest verified pinned bundle under the alias identity: the same
    // bytes but for `$id`, so the alias cannot describe anything unreleased.
    const { release, entry } = recorded
    writeAlias(
      family,
      major,
      stampId(bytes, aliasUrl(family, major)),
      release.tag,
      release.tag,
      entry.path,
    )
  }

  const writeProseLine = (
    family: string,
    major: string,
    ref: string,
    origin: string,
    dir: string,
  ): void => {
    const spec = specAt(family, major, ref, dir)
    if (spec === null) {
      console.log(`  · ${family}/${major}: no spec.md — skipped`)
      return
    }
    proseLines.push({ family, major, ref, dir })
    references.push({
      family,
      major,
      version: major,
      bundle: null,
      spec,
      examples: [],
      ref,
      dir,
      schemaPath: null,
    })
    console.log(`  ✓ /${RESERVED_PATH}/${family}/${major}/spec/ (prose only → ${origin})`)
  }

  for (const [key, { release, entry }] of newestProseByMajor) {
    const [family, major] = key.split('/') as [string, string]
    writeProseLine(family, major, release.tag, release.tag, entry.path)
  }

  for (const family of discoverFamilies(repoRoot)) {
    const workingDir = familyPaths(family.name, family.major).dir
    if (!hasPart(family.name, family.major, 'schema')) {
      if (newestProseByMajor.has(`${family.name}/${family.major}`)) continue
      writeProseLine(family.name, family.major, 'main', 'working tree', workingDir)
      continue
    }
    if (newestByMajor.has(`${family.name}/${family.major}`)) continue
    // Built in memory from the working tree's sources: nothing needs to have
    // run `task bundle` first, and no tracked bundle exists to read.
    const bundle = familyBundle(family)
    if (bundle === null) {
      console.log(`  · ${family.name}/${family.major}: no schema modules authored — skipped`)
      continue
    }
    writeAlias(family.name, family.major, bundle, 'main', 'working tree', workingDir)
  }

  // ---------------------------------------------------------------------------
  // Inventories.
  // ---------------------------------------------------------------------------
  for (const [family, versions] of versionsByFamily) {
    const latest = versions[versions.length - 1] as PublishedVersion
    emit(
      `${family}/versions.json`,
      canonicalJson({
        family,
        latest: latest.version,
        versions: versions.map((v) => ({ ...v })) as unknown as Json,
      }),
    )
    cacheRules.push({ source: `/${family}/versions.json`, headers: [REVALIDATE] })
    console.log(`  ✓ /${family}/versions.json (${versions.length} version(s))`)
  }

  // The ledger is published so a consumer can verify a vendored copy offline
  // without a checkout.
  emit(LEDGER_FILE, serializeLedger(ledger))
  cacheRules.push({ source: `/${LEDGER_FILE}`, headers: [REVALIDATE] })

  // Deliberately tag-independent: the catalog names each family's alias URL,
  // which is the same on a checkout that carries no tags at all.
  emit(CATALOG_NAME, canonicalJson(buildCatalog(repoRoot)))
  cacheRules.push({ source: `/${CATALOG_NAME}`, headers: [REVALIDATE] })
  console.log(`  ✓ /${CATALOG_NAME}`)

  // ---------------------------------------------------------------------------
  // The human entry point. Generated rather than committed for the reason
  // `docs/traceability.md` is: a page someone has to remember to update is a
  // page that is wrong. The registry index stays thin; the reference below it
  // carries the field-level detail, and nothing either emits is normative.
  // See docs/adr/0017.
  // ---------------------------------------------------------------------------
  const proseFamilies = new Set([
    ...proseLines.map((line) => line.family),
    ...proseReleasesByFamily.keys(),
  ])
  const families = [
    ...new Set([...aliases.map((a) => a.family), ...versionsByFamily.keys(), ...proseFamilies]),
  ]
    .sort()
    // Core first, as everywhere else: it is what every other row is built on.
    .sort((a, b) => Number(b === CORE_FAMILY) - Number(a === CORE_FAMILY))
  let pages = 0

  emit(
    'index.html',
    renderIndex(families, aliases, versionsByFamily, proseLines, proseReleasesByFamily),
  )
  pages += 1
  for (const family of families) {
    if (proseFamilies.has(family)) {
      emit(
        `${family}/index.html`,
        renderProseFamilyIndex(
          family,
          proseLines.filter((line) => line.family === family),
          proseReleasesByFamily.get(family) ?? [],
        ),
      )
      pages += 1
      continue
    }
    emit(
      `${family}/index.html`,
      renderFamilyIndex(
        family,
        aliases.filter((a) => a.family === family),
        versionsByFamily.get(family) ?? [],
      ),
    )
    pages += 1
  }
  emit('404.html', renderNotFound())
  pages += 1
  console.log(`  ✓ ${pages} page(s)`)

  // ---------------------------------------------------------------------------
  // The generated reference. A separate top-level namespace rather than a page
  // inside `/<family>/v<X.Y.Z>/`, because that directory is immutable for a
  // year: a rendering must stay fixable, while the bytes it describes must not.
  // Takes no `_headers` rule, exactly as the index pages do not.
  // ---------------------------------------------------------------------------
  const rendered = [...references].sort((a, b) =>
    `${a.family}/${a.version}`.localeCompare(`${b.family}/${b.version}`),
  )
  for (const target of rendered) {
    const base = `${RESERVED_PATH}/${target.family}/${target.version}`
    const prosePath = target.spec === null ? null : `/${base}/spec/`
    const context: ProseContext | null =
      target.spec === null
        ? null
        : {
            base: `/${base}/spec/`,
            outline: readOutline(target.spec),
            resolveLink: linkResolver(target, rendered),
          }

    if (target.bundle === null || target.schemaPath === null) {
      // Prose only: no field reference, no examples, no schema to link.
      if (target.spec === null || context === null) continue
      emit(
        `${base}/spec/index.html`,
        page(
          `${target.family} ${target.version} specification`,
          [
            `<p class="muted">${link(`/${RESERVED_PATH}/`, 'Reference')} / ${escapeHtml(target.family)} ` +
              `/ ${escapeHtml(target.version)}</p>`,
            renderProse(target.spec, context, `${target.family}/${target.major}/spec.md`),
            `<footer>${link(proseUrl(target.dir, target.ref), 'Source')}</footer>`,
          ].join('\n'),
        ),
      )
      continue
    }
    const schemaPath = target.schemaPath

    if (target.spec !== null) {
      emit(
        `${base}/spec/index.html`,
        page(
          `${target.family} ${target.version} specification`,
          [
            `<p class="muted">${link(`/${base}/`, 'Reference')} / ${escapeHtml(target.family)} ` +
              `/ ${escapeHtml(target.version)}</p>`,
            renderProse(target.spec, context, `${target.family}/${target.major}/spec.md`),
            `<footer>${link(`/${base}/`, 'Field reference')} · ` +
              `${link(schemaPath, 'JSON Schema')} · ` +
              `${link(proseUrl(target.dir, target.ref), 'Source')}</footer>`,
          ].join('\n'),
        ),
      )
    }

    const examplesPath = target.examples.length === 0 ? null : `/${base}/examples/`
    if (examplesPath !== null) {
      emit(`${base}/examples/index.html`, renderExamples(target, base, schemaPath))
    }

    const model = buildReference(JSON.parse(target.bundle) as Json, target.family, target.version)
    emit(
      `${base}/index.html`,
      page(
        `${model.title} — ${target.version}`,
        renderReference(model, {
          schemaPath,
          prosePath,
          examplesPath,
          sourceUrl: proseUrl(target.dir, target.ref),
          links: context,
        }),
      ),
    )
    for (const notice of model.notes) console.log(`  · ${target.family}: ${notice}`)
  }
  emit(`${RESERVED_PATH}/index.html`, renderReferenceIndex(rendered))
  console.log(`  ✓ /${RESERVED_PATH}/ (${rendered.length} reference(s))`)

  // The pages take no rule of their own. Cloudflare Pages already serves an
  // uncontested asset as `public, max-age=0, must-revalidate`, which is what an
  // index wants; and a rule would have to guess whether the request path is
  // `/component/` or `/component/index.html`, since Pages redirects between the
  // two. Adding one would buy nothing and could miss.

  // ---------------------------------------------------------------------------
  // The cache contract.
  // ---------------------------------------------------------------------------
  const rules = [...SHAPE_RULES, ...cacheRules.sort((a, b) => a.source.localeCompare(b.source))]
  assertNoOverlap(rules, served)
  write(join(siteDir, HEADERS_FILE), renderHeaders(rules))
  console.log(`  ✓ /${HEADERS_FILE} (${rules.length} rule(s))`)

  for (const notice of pendingNotices(repoRoot)) {
    console.log(`  · ${notice}`)
  }

  return {
    pinned,
    aliases: aliases.length,
    pages,
    reference: rendered.length,
    rules: rules.length,
  }
}

// =============================================================================
// Pages
// =============================================================================

/**
 * Rewrite a relative link out of `spec.md` into one this origin can serve.
 *
 * Three shapes, and a fourth that fails the build. Another family's prose
 * becomes a link into its own rendered page at the same version, so a reader
 * following a cross-family citation stays on the site. Everything else inside
 * the repository becomes a blob URL at the ref being described, so it resolves
 * to what this page describes rather than to `main`. A target that matches
 * neither throws: `check:links` exists because a citation that still looks like
 * a link and goes nowhere is worse than none, and generated output earns the
 * same rule.
 */
function linkResolver(
  target: ReferenceTarget,
  rendered: readonly ReferenceTarget[],
): (href: string) => string {
  const paths = releaseDirPaths(target.dir)
  const from = paths.dir
  return (href: string): string => {
    if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href

    const [rawPath = '', fragment] = href.split('#')
    const resolved = posixResolve(from, rawPath)
    const suffix = fragment === undefined ? '' : `#${fragment}`
    if (resolved === null) {
      throw new Error(
        `${paths.spec}: link target ${href} escapes the repository and cannot be rewritten. ` +
          'Add a case to linkResolver rather than publishing a link that goes nowhere.',
      )
    }

    const sibling = parseSpecPath(resolved)
    if (sibling !== null) {
      const { name: family, major } = sibling
      // The same version shape the reader is on: an exact release cites the
      // prose of its own moment, an alias cites the moving one.
      const peer =
        rendered.find((r) => r.family === family && r.version === target.version) ??
        rendered.find((r) => r.family === family && r.version === major)
      if (peer !== undefined) return `/${RESERVED_PATH}/${family}/${peer.version}/spec/${suffix}`
    }

    return `${REPO_URL}/blob/${target.ref}/${resolved}${suffix}`
  }
}

/** Resolve `../../x/y.md` against a repository-relative directory. */
function posixResolve(from: string, href: string): string | null {
  const parts = from.split('/')
  for (const segment of href.split('/')) {
    if (segment === '.' || segment === '') continue
    if (segment === '..') {
      if (parts.pop() === undefined) return null
      continue
    }
    parts.push(segment)
  }
  return parts.length === 0 ? null : parts.join('/')
}

/**
 * A family's example documents, verbatim.
 *
 * Verbatim is the point: `check:examples` validates exactly these bytes against
 * the bundle on the same commit, so what a reader copies is what CI proved
 * valid. Reformatting them here would publish something nothing had checked.
 */
function renderExamples(target: ReferenceTarget, base: string, schemaPath: string): string {
  const blocks = target.examples.map((example) =>
    [
      `<h2 id="${escapeHtml(example.name)}">${escapeHtml(example.name)}</h2>`,
      `<pre><code>${escapeHtml(example.body)}</code></pre>`,
    ].join('\n'),
  )

  return page(
    `${target.family} ${target.version} examples`,
    [
      `<p class="muted">${link(`/${base}/`, 'Reference')} / ${escapeHtml(target.family)} ` +
        `/ ${escapeHtml(target.version)}</p>`,
      `<h1>${escapeHtml(target.family)} examples</h1>`,
      '<p class="lead">Every example below is validated against the schema on this page ' +
        'in CI, so an example that does not validate fails the build rather than shipping.</p>',
      `<nav class="toc">${target.examples
        .map((e) => `<a href="#${encodeURIComponent(e.name)}">${escapeHtml(e.name)}</a>`)
        .join('')}</nav>`,
      ...blocks,
      `<footer>${[link(`/${base}/`, 'Field reference'), link(schemaPath, 'JSON Schema')].join(
        ' · ',
      )}</footer>`,
    ].join('\n'),
  )
}

/** The reference's own index: every family and version rendered. */
function renderReferenceIndex(rendered: readonly ReferenceTarget[]): string {
  const rows = rendered
    .map((target) => {
      // A prose-only target has no field reference page to name it; its row
      // points at the specification instead.
      const home =
        target.schemaPath === null
          ? `/${RESERVED_PATH}/${target.family}/${target.version}/spec/`
          : `/${RESERVED_PATH}/${target.family}/${target.version}/`
      return (
        `<tr><td>${link(home, target.family)}</td>` +
        `<td><code>${escapeHtml(target.version)}</code></td>` +
        `<td>${target.spec === null ? '<span class="muted">—</span>' : link(`/${RESERVED_PATH}/${target.family}/${target.version}/spec/`, 'specification')}</td>` +
        `<td>${target.examples.length === 0 ? '<span class="muted">—</span>' : link(`/${RESERVED_PATH}/${target.family}/${target.version}/examples/`, `${target.examples.length}`)}</td>` +
        `<td>${target.schemaPath === null ? '<span class="muted">—</span>' : link(target.schemaPath, 'schema')}</td></tr>`
      )
    })
    .join('')

  return page(
    'Musher schema reference',
    [
      `<p class="muted">${link('/', 'Schemas')} / reference</p>`,
      '<h1>Musher schema reference</h1>',
      '<p class="lead">A field-by-field reference for each document family, generated from the ' +
        "schema bundle it describes, beside that family's specification.</p>",
      '<table><thead><tr><th>Family</th><th>Version</th><th>Specification</th>' +
        '<th>Examples</th><th>Schema</th></tr></thead><tbody>' +
        rows +
        '</tbody></table>',
      '<p class="muted">Generated from the bytes each version serves, and informative. The ' +
        'specification and the schema bundle are what govern.</p>',
      `<footer>${link('/', 'Index')}</footer>`,
    ].join('\n'),
  )
}

/** A `spec.md` on GitHub, at the ref the reader is actually looking at, under that ref's directory. */
function proseUrl(dir: string, ref: string): string {
  return `${REPO_URL}/blob/${ref}/${releaseDirPaths(dir).spec}`
}

function renderIndex(
  families: readonly string[],
  aliases: readonly Alias[],
  versionsByFamily: ReadonlyMap<string, readonly PublishedVersion[]>,
  proseLines: readonly ProseLine[],
  proseReleasesByFamily: ReadonlyMap<string, readonly ProseRelease[]>,
): string {
  const muted = '<span class="muted">—</span>'
  const rows = families.map((family) => {
    const lines = proseLines.filter((line) => line.family === family)
    const proseReleases = proseReleasesByFamily.get(family)
    if (lines.length > 0 || proseReleases !== undefined) {
      // A schema-less family: no alias, no versions.json, prose only.
      const line = newestLine(lines)
      const latest = proseReleases?.[proseReleases.length - 1]
      return [
        '<tr>',
        `<td>${link(`/${family}/`, family)}</td>`,
        `<td>${muted}</td>`,
        `<td>${latest === undefined ? '<span class="muted">unreleased</span>' : escapeHtml(latest.version)}</td>`,
        `<td>${muted}</td>`,
        `<td>${line === undefined ? muted : link(proseUrl(line.dir, line.ref), 'spec.md')}</td>`,
        `<td>${line === undefined ? muted : link(`/${RESERVED_PATH}/${family}/${line.major}/spec/`, 'specification')}</td>`,
        '</tr>',
      ].join('')
    }
    const alias = aliases.find((a) => a.family === family)
    const versions = versionsByFamily.get(family) ?? []
    const latest = versions[versions.length - 1]
    return [
      '<tr>',
      `<td>${link(`/${family}/`, family)}</td>`,
      `<td>${alias === undefined ? '<span class="muted">—</span>' : `<code>${link(alias.path, alias.path)}</code>`}</td>`,
      `<td>${latest === undefined ? '<span class="muted">unreleased</span>' : escapeHtml(latest.version)}</td>`,
      `<td>${versions.length === 0 ? '<span class="muted">—</span>' : link(`/${family}/versions.json`, 'versions.json')}</td>`,
      `<td>${alias === undefined ? '<span class="muted">—</span>' : link(proseUrl(alias.dir, alias.ref), 'spec.md')}</td>`,
      `<td>${alias === undefined ? '<span class="muted">—</span>' : link(`/${RESERVED_PATH}/${family}/${alias.major}/`, 'reference')}</td>`,
      '</tr>',
    ].join('')
  })

  return page(
    'Musher schemas',
    [
      '<h1>Musher schemas</h1>',
      '<p class="lead">Canonical JSON Schema 2020-12 bundles for the Musher document families.',
      'This host serves the schemas; the normative prose, the conformance suite and the',
      `publication ledger live in ${link(REPO_URL, 'musher-dev/specifications')}.</p>`,
      '<table>',
      '<thead><tr><th>Family</th><th>Alias</th><th>Latest</th><th>Versions</th>',
      '<th>Prose</th><th>Reference</th></tr></thead>',
      `<tbody>${rows.join('')}</tbody>`,
      '</table>',
      '<p>An alias moves within its major version as backward-compatible additions ship.',
      'Automation must pin an exact version instead — those paths are served from verified',
      'immutable release assets, carry an <code>$id</code> naming that exact URL, and never change.</p>',
      `<p>The ${link(`/${RESERVED_PATH}/`, 'reference')} explains each family field by field, ` +
        'beside its specification. It is generated from the bytes each version serves, and is ' +
        'informative — the specification and the bundle are what govern.</p>',
      `<footer>${[
        link('/catalog.json', 'catalog.json'),
        link('/published.json', 'published.json'),
        link(`${REPO_URL}/releases`, 'releases'),
        link(`${REPO_URL}/blob/main/LICENSE`, 'Apache-2.0'),
      ].join(' · ')}</footer>`,
    ].join('\n'),
  )
}

function renderFamilyIndex(
  family: string,
  aliases: readonly Alias[],
  versions: readonly PublishedVersion[],
): string {
  const aliasRows = aliases.map((alias) =>
    [
      '<tr>',
      `<td><code>${link(alias.path, alias.path)}</code></td>`,
      `<td>${escapeHtml(alias.major)}</td>`,
      `<td>${alias.ref === 'main' ? '<span class="muted">unreleased — tracks main</span>' : `<code>${escapeHtml(alias.ref)}</code>`}</td>`,
      `<td>${link(proseUrl(alias.dir, alias.ref), 'spec.md')}</td>`,
      '</tr>',
    ].join(''),
  )

  const versionRows = [...versions].reverse().map((version) => {
    const path = new URL(version.url).pathname
    return [
      '<tr>',
      `<td>${escapeHtml(version.version)}</td>`,
      `<td><code>${link(path, path)}</code></td>`,
      `<td><code>${escapeHtml(version.tag)}</code></td>`,
      `<td class="hash">${escapeHtml(version.sha256)}</td>`,
      '</tr>',
    ].join('')
  })

  const published =
    versions.length === 0
      ? [
          '<p class="muted">Nothing has been released. Until this family is tagged its alias',
          'serves what is committed on <code>main</code>, and no exact-version URL exists.</p>',
        ]
      : [
          '<table>',
          '<thead><tr><th>Version</th><th>URL</th><th>Tag</th><th>SHA-256</th></tr></thead>',
          `<tbody>${versionRows.join('')}</tbody>`,
          '</table>',
          '<p class="muted">Every exact-version URL is immutable and is accompanied by a',
          '<code>.sha256</code> sidecar in <code>sha256sum</code> format.</p>',
        ]

  // A family removed from the working tree keeps serving what it published, so
  // it can reach here with releases and no alias. Saying so beats an empty table.
  const alias =
    aliasRows.length === 0
      ? [
          '<p class="muted">This family is no longer authored here. Its published versions',
          'remain served — nothing is ever unpublished — but no alias tracks it.</p>',
        ]
      : [
          '<table>',
          '<thead><tr><th>URL</th><th>Major</th><th>Serving</th><th>Prose</th></tr></thead>',
          `<tbody>${aliasRows.join('')}</tbody>`,
          '</table>',
        ]

  const newest = [...aliases]
    .map((a) => a.major)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .pop()

  return page(
    `${family} schemas`,
    [
      `<p>${link('/', 'Musher schemas')}</p>`,
      `<h1>${escapeHtml(family)}</h1>`,
      // The newest major, not the first: `aliases` arrives in release order, so
      // once a family has both v1 and v2 the first entry is the older one.
      ...(newest === undefined
        ? []
        : [
            `<p>${link(`/${RESERVED_PATH}/${family}/${newest}/`, 'Read the reference')}` +
              ' — every field, beside the specification.</p>',
          ]),
      '<h2>Alias</h2>',
      ...alias,
      '<h2>Published versions</h2>',
      ...published,
      `<footer>${[
        // Written only for a family that has released, so linked only then.
        ...(versions.length === 0 ? [] : [link(`/${family}/versions.json`, 'versions.json')]),
        link('/published.json', 'published.json'),
      ].join(' · ')}</footer>`,
    ].join('\n'),
  )
}

/** The line with the highest major, which is the one a reader should start from. */
function newestLine(lines: readonly ProseLine[]): ProseLine | undefined {
  return [...lines].sort((a, b) => Number(a.major.slice(1)) - Number(b.major.slice(1))).pop()
}

/**
 * The family index for a family that ships no schema.
 *
 * It mirrors `renderFamilyIndex` without the parts that describe schema URLs:
 * no alias, no exact-version paths, no checksums, no `versions.json`. What a
 * release of such a family publishes is its prose at the tag, so that is what
 * each row links.
 */
function renderProseFamilyIndex(
  family: string,
  lines: readonly ProseLine[],
  releases: readonly ProseRelease[],
): string {
  const lineRows = lines.map((line) =>
    [
      '<tr>',
      `<td>${link(`/${RESERVED_PATH}/${family}/${line.major}/spec/`, line.major)}</td>`,
      `<td>${line.ref === 'main' ? '<span class="muted">unreleased — tracks main</span>' : `<code>${escapeHtml(line.ref)}</code>`}</td>`,
      `<td>${link(proseUrl(line.dir, line.ref), 'spec.md')}</td>`,
      '</tr>',
    ].join(''),
  )

  const releaseRows = [...releases]
    .reverse()
    .map((release) =>
      [
        '<tr>',
        `<td>${link(`/${RESERVED_PATH}/${family}/v${release.version}/spec/`, release.version)}</td>`,
        `<td><code>${escapeHtml(release.tag)}</code></td>`,
        '</tr>',
      ].join(''),
    )

  const newest = newestLine(lines)

  return page(
    `${family} specification`,
    [
      `<p>${link('/', 'Musher schemas')}</p>`,
      `<h1>${escapeHtml(family)}</h1>`,
      '<p class="lead">This specification publishes no schema. Its rules are prose and a',
      'conformance corpus, and every document family built on it expresses them in its own',
      'schema.</p>',
      ...(newest === undefined
        ? []
        : [
            `<p>${link(`/${RESERVED_PATH}/${family}/${newest.major}/spec/`, 'Read the specification')}</p>`,
          ]),
      '<h2>Lines</h2>',
      ...(lineRows.length === 0
        ? [
            '<p class="muted">This family is no longer authored here. Its released editions',
            'remain listed below.</p>',
          ]
        : [
            '<table>',
            '<thead><tr><th>Line</th><th>Serving</th><th>Prose</th></tr></thead>',
            `<tbody>${lineRows.join('')}</tbody>`,
            '</table>',
          ]),
      '<h2>Released editions</h2>',
      ...(releaseRows.length === 0
        ? ['<p class="muted">Nothing has been released.</p>']
        : [
            '<table>',
            '<thead><tr><th>Version</th><th>Tag</th></tr></thead>',
            `<tbody>${releaseRows.join('')}</tbody>`,
            '</table>',
          ]),
      `<footer>${link('/published.json', 'published.json')}</footer>`,
    ].join('\n'),
  )
}

function renderNotFound(): string {
  return page(
    'Not found',
    [
      '<h1>Not found</h1>',
      '<p>No schema is published at this path.</p>',
      '<p class="muted">This host serves two schema path shapes per family —',
      '<code>/&lt;family&gt;/v1/&lt;family&gt;.schema.json</code> for the moving alias and',
      '<code>/&lt;family&gt;/v1.2.0/&lt;family&gt;.schema.json</code> for an exact version.',
      'A version that was never released has no URL; nothing is ever unpublished.</p>',
      `<p class="muted">The generated reference is under ${link(`/${RESERVED_PATH}/`, '/reference/')}.</p>`,
      `<p>${link('/', 'Index')}</p>`,
    ].join('\n'),
  )
}

function main(): void {
  const result = assembleSite({ repoRoot: REPO_ROOT, siteDir: SITE_DIR })
  console.log(
    `\nSite assembled at ${relativeToRepo(SITE_DIR)}: ` +
      `${result.aliases} alias path(s), ${result.pinned} immutable path(s), ` +
      `${result.pages} page(s), ${result.rules} header rule(s).`,
  )
}

if (import.meta.main) main()
