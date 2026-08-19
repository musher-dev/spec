/**
 * Assemble the publication tree deployed to https://schemas.musher.dev.
 *
 * Two URL shapes per family:
 *
 *   /<family>/v1/<family>.schema.json        moving alias within the major
 *   /<family>/v1.2.0/<family>.schema.json    immutable, published once
 *
 * **Pinned paths are rebuilt from tags, never from the working tree.** Every
 * release this repository has ever cut is reassembled on every deploy, so a
 * pinned URL neither moves when `main` moves nor disappears when a newer
 * version ships. The working tree feeds the alias only, and only until the
 * major has its first tag.
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
 * The guarantee that the bytes themselves never change is made here too, and
 * checked by `task check:published`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildCatalog } from './catalog.ts'
import { isShallow } from './git.ts'
import {
  discoverReleases,
  LEDGER_FILE,
  loadRelease,
  pendingNotices,
  pinnedUrl,
  type Release,
  readLedger,
  serializeLedger,
} from './released.ts'
import {
  canonicalJson,
  discoverFamilies,
  type Json,
  REPO_ROOT,
  REPO_URL,
  relativeToRepo,
  SITE_DIR,
} from './spec.ts'

export interface SiteOptions {
  readonly repoRoot: string
  readonly siteDir: string
}

export interface SiteResult {
  readonly pinned: number
  readonly aliases: number
  readonly pages: number
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

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

/** `sha256sum` output format, so `sha256sum -c` verifies a download unchanged. */
function checksumFile(hash: string, fileName: string): string {
  return `${hash}  ${fileName}\n`
}

interface PublishedVersion {
  readonly version: string
  readonly tag: string
  readonly url: string
  readonly sha256: string
}

/** A major-version alias, and the ref whose prose it currently corresponds to. */
interface Alias {
  readonly family: string
  readonly major: string
  readonly path: string
  /** The tag the alias serves, or `main` while the major has no tag. */
  readonly ref: string
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
  const releases = discoverReleases(repoRoot)

  if (releases.length === 0 && Object.keys(ledger.releases).length > 0 && isShallow(repoRoot)) {
    throw new Error(
      `${LEDGER_FILE} records released versions but no tags are present and this is a ` +
        'shallow clone. Run `git fetch --tags --unshallow` — deploying from here would ' +
        'unpublish every pinned version.',
    )
  }

  rmSync(siteDir, { recursive: true, force: true })
  mkdirSync(siteDir, { recursive: true })

  /** Every path served, in URL form. `_headers` is checked against exactly this. */
  const served: string[] = []
  /** Cache-Control rules, one per published path or per pinned release. */
  const cacheRules: HeaderRule[] = []

  const emit = (path: string, contents: string): void => {
    write(join(siteDir, ...path.split('/')), contents)
    served.push(`/${path}`)
  }

  // ---------------------------------------------------------------------------
  // Pinned paths, straight from the tags.
  // ---------------------------------------------------------------------------
  const newestByMajor = new Map<string, Release>()
  const versionsByFamily = new Map<string, PublishedVersion[]>()
  let pinned = 0

  for (const release of releases) {
    const loaded = loadRelease(repoRoot, release, ledger)
    const fileName = `${release.family}.schema.json`
    const dir = `${release.family}/v${release.version}`

    emit(`${dir}/${fileName}`, loaded.published)
    emit(`${dir}/${fileName}.sha256`, checksumFile(loaded.publishedSha256, fileName))
    // One rule for the release, not one per file: the sidecar is as immutable
    // as the bytes it attests, and a directory rule says so in half the budget.
    cacheRules.push({ source: `/${dir}/*`, headers: [IMMUTABLE] })
    console.log(`  ✓ /${dir}/${fileName} (immutable)`)
    pinned += 1

    // `releases` is sorted oldest-first, so the last write per major wins.
    newestByMajor.set(`${release.family}/${release.major}`, release)
    versionsByFamily.set(release.family, [
      ...(versionsByFamily.get(release.family) ?? []),
      {
        version: release.version,
        tag: release.tag,
        url: pinnedUrl(release),
        sha256: loaded.publishedSha256,
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
  ): void => {
    const path = `${family}/${major}/${family}.schema.json`
    emit(path, contents)
    cacheRules.push({ source: `/${path}`, headers: [REVALIDATE] })
    aliases.push({ family, major, path: `/${path}`, ref })
    console.log(`  ✓ /${path} (alias → ${origin})`)
  }

  for (const [key, release] of newestByMajor) {
    const [family, major] = key.split('/') as [string, string]
    const loaded = loadRelease(repoRoot, release, ledger)
    // The tag's own bytes, not the pinned copy: the alias URL is what the
    // committed bundle's `$id` already names, so these need no restamping.
    writeAlias(family, major, loaded.source.toString('utf8'), release.tag, release.tag)
  }

  for (const family of discoverFamilies(repoRoot)) {
    if (newestByMajor.has(`${family.name}/${family.major}`)) continue
    if (!existsSync(family.bundlePath)) {
      console.log(`  · ${family.name}/${family.major}: no bundle built — skipped`)
      continue
    }
    writeAlias(
      family.name,
      family.major,
      readFileSync(family.bundlePath, 'utf8'),
      'main',
      'working tree',
    )
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

  // Deliberately tag-independent: `catalog.json` is committed and CI checks it
  // is current on checkouts that may carry no tags at all.
  emit('catalog.json', canonicalJson(buildCatalog(repoRoot)))
  cacheRules.push({ source: '/catalog.json', headers: [REVALIDATE] })
  console.log('  ✓ /catalog.json')

  // ---------------------------------------------------------------------------
  // The human entry point. Generated rather than committed for the reason
  // `docs/traceability.md` is: a page someone has to remember to update is a
  // page that is wrong. Deliberately thin — this is a registry, and the
  // normative prose stays in each family's spec.md.
  // ---------------------------------------------------------------------------
  const families = [
    ...new Set([...aliases.map((a) => a.family), ...versionsByFamily.keys()]),
  ].sort()
  let pages = 0

  emit('index.html', renderIndex(families, aliases, versionsByFamily))
  pages += 1
  for (const family of families) {
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

  return { pinned, aliases: aliases.length, pages, rules: rules.length }
}

// =============================================================================
// Pages
// =============================================================================

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const STYLE = [
  ':root{color-scheme:light dark;--muted:#5c5f66;--rule:#8884}',
  '@media(prefers-color-scheme:dark){:root{--muted:#9aa0a6}}',
  'body{margin:0 auto;max-width:54rem;padding:2.5rem 1.25rem 4rem;',
  'font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  'h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1rem;margin:2.5rem 0 .5rem}',
  'p{margin:.5rem 0}.lead,footer,.muted{color:var(--muted)}',
  'table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.9375rem}',
  'th,td{border-bottom:1px solid var(--rule);padding:.5rem .6rem;text-align:left;',
  'vertical-align:top}',
  'th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}',
  'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875rem}',
  '.hash{color:var(--muted);word-break:break-all;font-size:.8125rem}',
  'footer{margin-top:3.5rem;padding-top:1rem;border-top:1px solid var(--rule);font-size:.875rem}',
].join('')

function page(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    body,
    '',
  ].join('\n')
}

/** A `spec.md` on GitHub, at the ref the reader is actually looking at. */
function proseUrl(family: string, major: string, ref: string): string {
  return `${REPO_URL}/blob/${ref}/specifications/${family}/${major}/spec.md`
}

function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
}

function renderIndex(
  families: readonly string[],
  aliases: readonly Alias[],
  versionsByFamily: ReadonlyMap<string, readonly PublishedVersion[]>,
): string {
  const rows = families.map((family) => {
    const alias = aliases.find((a) => a.family === family)
    const versions = versionsByFamily.get(family) ?? []
    const latest = versions[versions.length - 1]
    return [
      '<tr>',
      `<td>${link(`/${family}/`, family)}</td>`,
      `<td>${alias === undefined ? '<span class="muted">—</span>' : `<code>${link(alias.path, alias.path)}</code>`}</td>`,
      `<td>${latest === undefined ? '<span class="muted">unreleased</span>' : escapeHtml(latest.version)}</td>`,
      `<td>${versions.length === 0 ? '<span class="muted">—</span>' : link(`/${family}/versions.json`, 'versions.json')}</td>`,
      `<td>${alias === undefined ? '<span class="muted">—</span>' : link(proseUrl(family, alias.major, alias.ref), 'spec.md')}</td>`,
      '</tr>',
    ].join('')
  })

  return page(
    'Musher schemas',
    [
      '<h1>Musher schemas</h1>',
      '<p class="lead">Canonical JSON Schema 2020-12 bundles for the Musher document families.',
      'This host serves the schemas; the normative prose, the conformance suite and the',
      `publication ledger live in ${link(REPO_URL, 'musher-dev/spec')}.</p>`,
      '<table>',
      '<thead><tr><th>Family</th><th>Alias</th><th>Latest</th><th>Versions</th>',
      '<th>Prose</th></tr></thead>',
      `<tbody>${rows.join('')}</tbody>`,
      '</table>',
      '<p>An alias moves within its major version as backward-compatible additions ship.',
      'Automation must pin an exact version instead — those paths are rebuilt from their git',
      'tags on every deploy, carry an <code>$id</code> naming that exact URL, and never change.</p>',
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
      `<td>${link(proseUrl(family, alias.major, alias.ref), 'spec.md')}</td>`,
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

  return page(
    `${family} schemas`,
    [
      `<p>${link('/', 'Musher schemas')}</p>`,
      `<h1>${escapeHtml(family)}</h1>`,
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

function renderNotFound(): string {
  return page(
    'Not found',
    [
      '<h1>Not found</h1>',
      '<p>No schema is published at this path.</p>',
      '<p class="muted">This host serves two path shapes per family —',
      '<code>/&lt;family&gt;/v1/&lt;family&gt;.schema.json</code> for the moving alias and',
      '<code>/&lt;family&gt;/v1.2.0/&lt;family&gt;.schema.json</code> for an exact version.',
      'A version that was never released has no URL; nothing is ever unpublished.</p>',
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
