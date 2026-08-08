/**
 * Validate every example document against its family's published bundle.
 *
 * Examples are copied verbatim into the documentation site, so an example that
 * does not validate is a documentation bug that ships. This check is why the
 * README can promise the quick-start actually works.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { discoverFamilies, Failures, relativeToRepo } from './spec.ts'
import { validateDocument } from './validator.ts'

function main(): void {
  const failures = new Failures()
  let checked = 0

  for (const family of discoverFamilies()) {
    if (!existsSync(family.bundlePath)) {
      const examples = existsSync(family.examplesDir)
        ? readdirSync(family.examplesDir).filter((e) => e.endsWith('.yaml'))
        : []
      if (examples.length > 0) {
        failures.add(
          `${family.name}/${family.major}: ${examples.length} example(s) present but no bundle ` +
            'has been built — run `task bundle`',
        )
      }
      continue
    }
    if (!existsSync(family.examplesDir)) continue

    const files = readdirSync(family.examplesDir)
      .filter((e) => e.endsWith('.yaml') || e.endsWith('.yml'))
      .sort()

    for (const file of files) {
      const path = join(family.examplesDir, file)
      const result = validateDocument(family, readFileSync(path, 'utf8'))
      checked += 1

      if (result.ok) {
        console.log(`  ✓ ${relativeToRepo(path)}`)
        continue
      }
      const detail = result.diagnostics
        .map((d) => `        ${d.code} at ${d.path || '/'} — ${d.message}`)
        .join('\n')
      failures.add(`${relativeToRepo(path)} failed in the ${result.phase} phase:\n${detail}`)
    }
  }

  failures.report(checked === 0 ? 'No examples to validate.' : `${checked} example(s) validate.`)
}

main()
