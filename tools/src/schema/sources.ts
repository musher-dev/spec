/**
 * Where a bundle's source modules are read from.
 *
 * The bundler never touches the filesystem or git itself. It asks a reader, so
 * the same compile runs over the working tree, over a base branch for a review
 * report, and over a release tag — without a temporary checkout, and without a
 * second copy of the build that could disagree with the first.
 *
 * Paths are repo-relative and POSIX, the way `lib/layout.ts` names them.
 *
 * `node:` imports only, like `bundle.ts`: this is part of the command a
 * downstream consumer runs at a pinned commit without `bun install`.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { listTreeChildren, readBlobAtRef } from '../lib/git.ts'
import { inRepo } from '../lib/layout.ts'

export interface ModuleReader {
  /**
   * The names of the files directly inside a repo-relative directory, in no
   * promised order. Empty when the directory does not exist.
   */
  list(dir: string): string[]
  /** A repo-relative file's bytes, or null when it does not exist. */
  read(path: string): Buffer | null
}

/** Read the working tree of the repository at `repoRoot`. */
export function fsReader(repoRoot: string): ModuleReader {
  return {
    list(dir) {
      const absolute = inRepo(repoRoot, dir)
      let entries: string[]
      try {
        entries = readdirSync(absolute)
      } catch {
        return []
      }
      return entries.filter((entry) => statSync(inRepo(absolute, entry)).isFile())
    },
    read(path) {
      try {
        return readFileSync(inRepo(repoRoot, path))
      } catch {
        return null
      }
    },
  }
}

/** Read the tree a git ref names, through `git ls-tree` and `git cat-file`. */
export function gitReader(repoRoot: string, ref: string): ModuleReader {
  return {
    list: (dir) => listTreeChildren(repoRoot, ref, dir),
    read: (path) => readBlobAtRef(repoRoot, ref, path),
  }
}
