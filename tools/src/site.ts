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
 * GitHub Pages cannot set Cache-Control, so cache immutability is enforced at
 * the Cloudflare edge by a rule keyed on the versioned path shape. That is a
 * caching concern; the guarantee that the bytes themselves never change is
 * made here, and checked by `task check:published`.
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
  relativeToRepo,
  SITE_DIR,
  SITE_HOST,
} from './spec.ts'

export interface SiteOptions {
  readonly repoRoot: string
  readonly siteDir: string
}

export interface SiteResult {
  readonly pinned: number
  readonly aliases: number
}

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

  // Pages runs Jekyll by default, which would swallow files beginning with an
  // underscore and rewrite others.
  write(join(siteDir, '.nojekyll'), '')
  write(join(siteDir, 'CNAME'), `${SITE_HOST}\n`)

  // ---------------------------------------------------------------------------
  // Pinned paths, straight from the tags.
  // ---------------------------------------------------------------------------
  const newestByMajor = new Map<string, Release>()
  const versionsByFamily = new Map<string, PublishedVersion[]>()
  let pinned = 0

  for (const release of releases) {
    const loaded = loadRelease(repoRoot, release, ledger)
    const fileName = `${release.family}.schema.json`
    const dir = join(siteDir, release.family, `v${release.version}`)

    write(join(dir, fileName), loaded.published)
    write(join(dir, `${fileName}.sha256`), checksumFile(loaded.publishedSha256, fileName))
    console.log(`  ✓ /${release.family}/v${release.version}/${fileName} (immutable)`)
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
  let aliases = 0

  const writeAlias = (family: string, major: string, contents: string, origin: string): void => {
    const fileName = `${family}.schema.json`
    write(join(siteDir, family, major, fileName), contents)
    console.log(`  ✓ /${family}/${major}/${fileName} (alias → ${origin})`)
    aliases += 1
  }

  for (const [key, release] of newestByMajor) {
    const [family, major] = key.split('/') as [string, string]
    const loaded = loadRelease(repoRoot, release, ledger)
    // The tag's own bytes, not the pinned copy: the alias URL is what the
    // committed bundle's `$id` already names, so these need no restamping.
    writeAlias(family, major, loaded.source.toString('utf8'), release.tag)
  }

  for (const family of discoverFamilies(repoRoot)) {
    if (newestByMajor.has(`${family.name}/${family.major}`)) continue
    if (!existsSync(family.bundlePath)) {
      console.log(`  · ${family.name}/${family.major}: no bundle built — skipped`)
      continue
    }
    writeAlias(family.name, family.major, readFileSync(family.bundlePath, 'utf8'), 'working tree')
  }

  // ---------------------------------------------------------------------------
  // Inventories.
  // ---------------------------------------------------------------------------
  for (const [family, versions] of versionsByFamily) {
    const latest = versions[versions.length - 1] as PublishedVersion
    write(
      join(siteDir, family, 'versions.json'),
      canonicalJson({
        family,
        latest: latest.version,
        versions: versions.map((v) => ({ ...v })) as unknown as Json,
      }),
    )
    console.log(`  ✓ /${family}/versions.json (${versions.length} version(s))`)
  }

  // The ledger is published so a consumer can verify a vendored copy offline
  // without a checkout.
  write(join(siteDir, LEDGER_FILE), serializeLedger(ledger))

  // Deliberately tag-independent: `catalog.json` is committed and CI checks it
  // is current on checkouts that may carry no tags at all.
  write(join(siteDir, 'catalog.json'), canonicalJson(buildCatalog(repoRoot)))
  console.log('  ✓ /catalog.json')

  for (const notice of pendingNotices(repoRoot)) {
    console.log(`  · ${notice}`)
  }

  return { pinned, aliases }
}

function main(): void {
  const result = assembleSite({ repoRoot: REPO_ROOT, siteDir: SITE_DIR })
  console.log(
    `\nSite assembled at ${relativeToRepo(SITE_DIR)}: ` +
      `${result.aliases} alias path(s), ${result.pinned} immutable path(s).`,
  )
}

if (import.meta.main) main()
