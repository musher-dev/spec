/**
 * Fail if a committed bundle does not byte-match a fresh compile of its source
 * modules.
 *
 * This is the anti-drift gate. Bundles are committed so reviewers can read the
 * generated output in a diff; this check is what stops that output from
 * becoming a second, divergent source of truth.
 */
import { existsSync, readFileSync } from 'node:fs'
import { buildBundle } from './bundle.ts'
import { discoverFamilies, Failures, relativeToRepo, sourceModules } from './spec.ts'

function firstDifference(expected: string, actual: string): string {
  const expectedLines = expected.split('\n')
  const actualLines = actual.split('\n')
  const limit = Math.max(expectedLines.length, actualLines.length)
  for (let i = 0; i < limit; i += 1) {
    if (expectedLines[i] !== actualLines[i]) {
      return (
        `first difference at line ${i + 1}:\n` +
        `      committed: ${JSON.stringify(actualLines[i] ?? '<end of file>')}\n` +
        `      expected:  ${JSON.stringify(expectedLines[i] ?? '<end of file>')}`
      )
    }
  }
  return 'files differ only in trailing bytes'
}

function main(): void {
  const failures = new Failures()
  const families = discoverFamilies()
  let checked = 0

  for (const family of families) {
    const expected = buildBundle(family)

    if (expected === null) {
      if (existsSync(family.bundlePath)) {
        failures.add(
          `${relativeToRepo(family.bundlePath)} exists but ` +
            `${relativeToRepo(family.srcDir)} has no modules — delete the stale bundle`,
        )
      }
      continue
    }

    checked += 1
    if (!existsSync(family.bundlePath)) {
      failures.add(
        `${relativeToRepo(family.bundlePath)} is missing — run \`task bundle\` and commit it`,
      )
      continue
    }

    const actual = readFileSync(family.bundlePath, 'utf8')
    if (actual !== expected) {
      failures.add(
        `${relativeToRepo(family.bundlePath)} is stale — run \`task bundle\` and commit it\n` +
          `      sources: ${sourceModules(family).map(relativeToRepo).join(', ')}\n` +
          `      ${firstDifference(expected, actual)}`,
      )
    }
  }

  failures.report(
    checked === 0 ? 'No bundles to check.' : `${checked} bundle(s) match their sources.`,
  )
}

main()
