/**
 * Assemble the publication tree deployed to https://schemas.musher.dev.
 *
 * Two URL shapes per family:
 *
 *   /<family>/v1/<family>.schema.json        moving alias within the major
 *   /<family>/v1.2.0/<family>.schema.json    immutable, published once
 *
 * Automation pins the immutable path. The alias exists so editors pick up
 * backward-compatible additions without a config change — it is not a stable
 * target for a build.
 *
 * GitHub Pages cannot set Cache-Control, so immutability is enforced at the
 * Cloudflare edge by a rule keyed on the versioned path shape.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCatalog } from './catalog.ts'
import { canonicalJson, discoverFamilies, relativeToRepo, SITE_DIR, SITE_HOST } from './spec.ts'
import { assertMajorMatches, releasedVersion } from './version.ts'

function main(): void {
  rmSync(SITE_DIR, { recursive: true, force: true })
  mkdirSync(SITE_DIR, { recursive: true })

  // Pages runs Jekyll by default, which would swallow files beginning with an
  // underscore and rewrite others.
  writeFileSync(join(SITE_DIR, '.nojekyll'), '', 'utf8')
  writeFileSync(join(SITE_DIR, 'CNAME'), `${SITE_HOST}\n`, 'utf8')

  let published = 0
  let pinned = 0

  for (const family of discoverFamilies()) {
    if (!existsSync(family.bundlePath)) {
      console.log(`  · ${family.name}/${family.major}: no bundle built — skipped`)
      continue
    }

    const fileName = `${family.name}.schema.json`

    const aliasDir = join(SITE_DIR, family.name, family.major)
    mkdirSync(aliasDir, { recursive: true })
    cpSync(family.bundlePath, join(aliasDir, fileName))
    console.log(`  ✓ /${family.name}/${family.major}/${fileName}`)
    published += 1

    const version = releasedVersion(family)
    if (version === null) {
      console.log(
        `  · ${family.name}: no release yet — immutable path will appear with the first tag`,
      )
      continue
    }
    assertMajorMatches(family, version)

    const pinnedDir = join(SITE_DIR, family.name, `v${version}`)
    if (existsSync(pinnedDir)) {
      throw new Error(
        `${family.name}: /v${version}/ already exists in the site tree. Released ` +
          'versions are immutable — publish a new patch instead.',
      )
    }
    mkdirSync(pinnedDir, { recursive: true })
    cpSync(family.bundlePath, join(pinnedDir, fileName))
    console.log(`  ✓ /${family.name}/v${version}/${fileName} (immutable)`)
    pinned += 1
  }

  writeFileSync(join(SITE_DIR, 'catalog.json'), canonicalJson(buildCatalog()), 'utf8')
  console.log('  ✓ /catalog.json')

  console.log(
    `\nSite assembled at ${relativeToRepo(SITE_DIR)}: ` +
      `${published} alias path(s), ${pinned} immutable path(s).`,
  )
}

main()
