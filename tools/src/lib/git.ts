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
 * The names of the files directly inside `dir` as of a ref — not recursive, no
 * subdirectories. Empty when the ref or the directory does not exist.
 *
 * `-z` so a name git would otherwise quote comes back verbatim.
 */
export function listTreeChildren(repoRoot: string, ref: string, dir: string): string[] {
  const { status, stdout } = run(repoRoot, ['ls-tree', '-z', '--full-tree', ref, '--', `${dir}/`])
  if (status !== 0) return []
  const names: string[] = []
  for (const record of stdout.toString('utf8').split('\0')) {
    // `<mode> SP <type> SP <object> TAB <path>`
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const [, type] = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    if (type !== 'blob' || !path.startsWith(`${dir}/`)) continue
    names.push(path.slice(dir.length + 1))
  }
  return names
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

/** True when `ref` names a tag in this repository. */
export function tagExists(repoRoot: string, tag: string): boolean {
  const { status, stderr } = run(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])
  if (status === 0) return true
  if (status === 1) return false
  throw new Error(`git rev-parse refs/tags/${tag} failed (${status}) — ${stderr.trim()}`)
}

/** Throw unless `ref` resolves to a commit. The guard before reading anything at it. */
export function assertCommit(repoRoot: string, ref: string): string {
  return git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])
}

/**
 * Whether commit `a` is an ancestor of (or equal to) commit `b`.
 *
 * `merge-base --is-ancestor` answers 0 or 1; anything else — a ref that does
 * not resolve, a corrupt object — is an error, not a "no".
 */
export function isAncestor(repoRoot: string, a: string, b: string): boolean {
  const { status, stderr } = run(repoRoot, ['merge-base', '--is-ancestor', a, b])
  if (status === 0) return true
  if (status === 1) return false
  throw new Error(`git merge-base --is-ancestor ${a} ${b} failed (${status}) — ${stderr.trim()}`)
}

/**
 * Git's tree id for a directory as of a ref, or null when the ref does not carry
 * that path as a directory.
 *
 * The ref must exist: a missing ref throws rather than reading as "no tree",
 * because the caller would otherwise report a moved directory for what is a
 * tag that was never fetched.
 */
export function treeId(repoRoot: string, ref: string, path: string): string | null {
  assertCommit(repoRoot, ref)
  const spec = `${ref}:${path}`
  const { status, stdout, stderr } = run(repoRoot, ['rev-parse', '--verify', '--quiet', spec])
  if (status === 1) return null
  if (status !== 0) {
    throw new Error(`git rev-parse ${spec} failed (${status}) — ${stderr.trim()}`)
  }
  const id = stdout.toString('utf8').trim()
  return git(repoRoot, ['cat-file', '-t', id]) === 'tree' ? id : null
}

/** Whether the working tree or the index differs from HEAD anywhere under `path`. */
export function isDirty(repoRoot: string, path: string): boolean {
  return git(repoRoot, ['status', '--porcelain', '--untracked-files=all', '--', path]) !== ''
}

export interface LogEntry {
  readonly sha: string
  readonly subject: string
  readonly body: string
}

/**
 * The non-merge commits reachable from `to` and not from `from` that touch
 * `path`, newest first.
 *
 * Merge commits are left out on purpose: a merge carries no change of its own
 * that a conventional-commit reader would classify, and release-please skips
 * them too.
 */
export function logRange(repoRoot: string, from: string, to: string, path: string): LogEntry[] {
  assertCommit(repoRoot, from)
  assertCommit(repoRoot, to)
  const { status, stdout, stderr } = run(repoRoot, [
    'log',
    '--no-merges',
    '--format=%H%x00%s%x00%b%x1e',
    `${from}..${to}`,
    '--',
    path,
  ])
  if (status !== 0) {
    throw new Error(`git log ${from}..${to} -- ${path} failed (${status}) — ${stderr.trim()}`)
  }
  const entries: LogEntry[] = []
  for (const record of stdout.toString('utf8').split('\x1e')) {
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed === '') continue
    const [sha = '', subject = '', body = ''] = trimmed.split('\0')
    entries.push({ sha, subject, body: body.trimEnd() })
  }
  return entries
}
