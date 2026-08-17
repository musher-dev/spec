/**
 * The narrow slice of git this repository's tooling needs.
 *
 * Every function takes `repoRoot` explicitly rather than reaching for the
 * process's working directory. That is not ceremony: it is what lets the site
 * assembler run against a throwaway fixture repository in a test, which is the
 * only way to prove that a published version stays put across releases.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { spawnSync } from 'node:child_process'

/**
 * Git invoked with the environment neutralised.
 *
 * A developer's global config, commit signing, or hook path must not change
 * what the tooling reads, and in a test it must not change what the fixture
 * repository does. `GIT_CONFIG_GLOBAL=/dev/null` is the documented way to say
 * "ignore ~/.gitconfig" without mutating anything.
 */
function run(repoRoot: string, args: string[]): { status: number; stdout: Buffer; stderr: string } {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error !== undefined) {
    throw new Error(`git ${args.join(' ')} could not be run — ${result.error.message}`)
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8'),
  }
}

/** Run git and return trimmed stdout, throwing on a non-zero exit. */
export function git(repoRoot: string, args: string[]): string {
  const { status, stdout, stderr } = run(repoRoot, args)
  if (status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${status}) — ${stderr.trim()}`)
  }
  return stdout.toString('utf8').trim()
}

/** True when the repository has no commits yet — a fresh `git init`. */
export function isEmptyRepository(repoRoot: string): boolean {
  return run(repoRoot, ['rev-parse', '--verify', 'HEAD']).status !== 0
}

/**
 * True when history was truncated by `--depth`.
 *
 * A shallow clone can hold zero tags and still look healthy, which would
 * publish an empty set of pinned paths and read as "nothing has been released".
 * Callers turn this into a hard failure rather than a silent 404.
 */
export function isShallow(repoRoot: string): boolean {
  return git(repoRoot, ['rev-parse', '--is-shallow-repository']) === 'true'
}

/** Every tag in the repository, in git's own ordering. */
export function listTags(repoRoot: string): string[] {
  const output = git(repoRoot, ['tag', '--list'])
  return output === '' ? [] : output.split('\n')
}

/** The commit a ref resolves to, peeling an annotated tag. */
export function tagCommit(repoRoot: string, ref: string): string {
  return git(repoRoot, ['rev-parse', `${ref}^{commit}`])
}

/** Every file under `path` as of a ref, repo-relative, sorted by git. */
export function listTreeFiles(repoRoot: string, ref: string, path: string): string[] {
  const { status, stdout } = run(repoRoot, ['ls-tree', '-r', '--name-only', ref, '--', path])
  if (status !== 0) return []
  const output = stdout.toString('utf8').trim()
  return output === '' ? [] : output.split('\n')
}

/**
 * A file's bytes as of a ref, or null when the ref does not carry that path.
 *
 * Returned as a Buffer and never decoded here. The published checksum has to be
 * of the bytes git stored, so anything that re-encodes on the way through would
 * make the hash describe a different artifact than the one it names.
 */
export function readBlobAtRef(repoRoot: string, ref: string, path: string): Buffer | null {
  const { status, stdout } = run(repoRoot, ['cat-file', 'blob', `${ref}:${path}`])
  return status === 0 ? stdout : null
}
