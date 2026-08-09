/**
 * Regenerate the SchemaStore-compatible catalog.
 *
 * The catalog is how a generic editor discovers the right schema for a file
 * without the author writing a modeline. It intentionally points at the
 * major-version alias, not an immutable version: editors should pick up
 * backward-compatible additions without a config change.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, discoverFamilies, type Json, REPO_ROOT } from './spec.ts'

const CATALOG_PATH = join(REPO_ROOT, 'catalog.json')

/**
 * Glob patterns an editor uses to bind a family's schema to a file.
 *
 * A blueprint's `component` reference is a relative path, so a component
 * document is not obliged to live under `components/` — a flat directory
 * beside the blueprint is equally valid. The component patterns cover both;
 * binding only the directory form would leave the flat layout with no editor
 * support for the exact layout the reference form exists to permit.
 */
const FILE_MATCH: Record<string, string[]> = {
  component: [
    '**/components/*.yaml',
    '**/components/*.yml',
    '**/component.yaml',
    '**/component.yml',
    '**/component-*.yaml',
    '**/component-*.yml',
  ],
  blueprint: ['**/blueprint.yaml', '**/blueprint.yml'],
  listing: ['**/listing.yaml', '**/listing.yml'],
}

const DESCRIPTION: Record<string, string> = {
  component: 'Musher component document — one reusable workload definition.',
  blueprint: 'Musher blueprint document — a deployable composition of components.',
  listing: 'Musher listing document — a catalog storefront entry.',
}

const TITLE: Record<string, string> = {
  component: 'Musher Component Document',
  blueprint: 'Musher Blueprint Document',
  listing: 'Musher Listing Document',
}

export function buildCatalog(): Json {
  const schemas: Json[] = []

  for (const family of discoverFamilies()) {
    const fileMatch = FILE_MATCH[family.name]
    if (fileMatch === undefined) {
      throw new Error(
        `catalog: family "${family.name}" has no fileMatch patterns. Add them in ` +
          'tools/src/catalog.ts — an unlisted family is invisible to editors.',
      )
    }
    schemas.push({
      name: TITLE[family.name] ?? family.name,
      description: DESCRIPTION[family.name] ?? '',
      fileMatch,
      url: family.bundleUrl,
      versions: { [family.major]: family.bundleUrl },
    })
  }

  return {
    $schema: 'https://json.schemastore.org/schema-catalog.json',
    version: 1,
    schemas,
  }
}

function main(): void {
  const catalog = buildCatalog()
  writeFileSync(CATALOG_PATH, canonicalJson(catalog), 'utf8')
  const count = ((catalog as { schemas: Json[] }).schemas ?? []).length
  console.log(`  ✓ catalog.json (${count} schema(s))`)
}

if (import.meta.main) main()
