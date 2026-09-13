/**
 * Fail if git tracks any build output.
 *
 * Schema bundles and the catalog are built, not committed (docs/adr/0023). A
 * tracked copy is a second source of truth: it can disagree with the sources it
 * claims to come from, and a consumer reading it from a raw URL would read
 * whichever of the two happened to be committed last. `task bundle` writes them
 * under `dist/`, which `.gitignore` excludes; this catches the `git add -f`, the
 * resurrected legacy path, and the file a merge brings back.
 *
 * Staleness of docs/traceability.md is not checked here: CI regenerates it and
 * diffs.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { git } from '../lib/git.ts'
import { Failures, GENERATED_PATH_PATTERNS, REPO_ROOT } from '../lib/layout.ts'

/** Every tracked path that is build output, repo-relative and sorted. */
export function trackedBuildOutput(repoRoot: string): string[] {
  const output = git(repoRoot, ['ls-files', '--full-name', '--', ...GENERATED_PATH_PATTERNS])
  return output === '' ? [] : output.split('\n').sort()
}

function main(): void {
  const failures = new Failures()
  for (const path of trackedBuildOutput(REPO_ROOT)) {
    failures.add(
      `${path} is build output and must not be tracked. Run \`git rm --cached ${path}\`; ` +
        '`task bundle` rebuilds it under dist/.',
    )
  }
  failures.report('No build output is tracked.')
}

if (import.meta.main) main()
