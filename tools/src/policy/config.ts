/**
 * Detect `.config/` layout drift.
 *
 * Tool configuration lives in one place, and every caller names its config
 * with the tool's own flag. That convention is worth exactly as much as its
 * enforcement: `musher-dev/platform` shipped the prose version of this rule
 * with no mechanical gate, and in that state two non-configs accreted inside
 * the directory and four lint tools quietly ran on defaults. The rules below are
 * what stops the same drift here.
 *
 * Two of them earn their place by catching failures that are silent rather
 * than loud. CFG-06: lefthook's config search is first-match-wins over
 * `lefthook.*` → `.lefthook.*` → `.config/lefthook.*`, so a stray root file
 * shadows this directory's copy with no warning — a different set of hooks
 * runs and nothing says so. CFG-04: a config nothing reads still reads as
 * authoritative to the next person to open it.
 *
 * The codes are shared with `musher-dev/development-container` and
 * `musher-dev/platform`, which run the same rules from a Python CLI. Three
 * repositories, one convention, one vocabulary for reporting a breach of it.
 *
 * CFG-09 is this repository's own: the root holds only the entries
 * `ROOT_ENTRIES` names (docs/adr/0024), so a leftover or a stray file fails
 * rather than accreting one commit at a time.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { git } from '../lib/git.ts'
import { Failures, REPO_ROOT, ROOT_ENTRIES } from '../lib/layout.ts'

const CONFIG_DIR = '.config'

/**
 * Configs the tool finds on its own, and so cannot be required to have a
 * caller. Keep this short — every entry is a dependency on discovery
 * behaviour that a tool upgrade could change underneath us.
 */
const AUTO_DISCOVERED: { readonly [file: string]: string } = {
  'lefthook.yml': 'lefthook searches .config/ natively',
}

/** Gitignored personal overrides. Present or absent, never indexed. */
const LOCAL_OVERRIDES = ['lefthook-local.yml', 'lefthook-local.yaml']

/**
 * The only files allowed at the top level of `.config/` rather than inside a
 * concern bucket. Lefthook qualifies solely because its config search does not
 * descend past `.config/lefthook.*` — bucketing it would stop every hook.
 */
const TOP_LEVEL_ALLOWED = ['README.md', ...Object.keys(AUTO_DISCOVERED), ...LOCAL_OVERRIDES]

/**
 * Suffixes that make a file a program rather than a declaration. A denylist
 * rather than an allowlist of config extensions, because a legitimate config
 * may carry no extension at all and the drift to prevent is specifically an
 * executable arriving.
 */
const EXECUTABLE_SUFFIXES = ['.sh', '.bash', '.zsh', '.py', '.mjs', '.cjs', '.js', '.ts', '.rb']

/** Every root filename that would win lefthook's first-match-wins search. */
const SHADOWING = [
  'lefthook.yml',
  'lefthook.yaml',
  'lefthook.json',
  'lefthook.jsonc',
  'lefthook.toml',
  '.lefthook.yml',
  '.lefthook.yaml',
  '.lefthook.json',
  '.lefthook.jsonc',
  '.lefthook.toml',
]

/**
 * Tool configs that belong in `.config/` and must never reappear at the root.
 *
 * Git and Task files are deliberately absent: they are root-only
 * by their own tools' rules, with no flag that could point elsewhere. So are
 * `tools/biome.json` and `tools/tsconfig.json`, which belong to the `tools/`
 * package and are resolved by it.
 */
const STRAY_ROOT_CONFIGS = [
  'cspell.json',
  'cspell.jsonc',
  '.cspell.json',
  'cspell.config.json',
  '.markdownlint.json',
  '.markdownlint.jsonc',
  '.markdownlint.yaml',
  '.markdownlint-cli2.jsonc',
  '.markdownlint-cli2.yaml',
  '.yamllint',
  '.yamllint.yml',
  '.yamllint.yaml',
  'actionlint.yaml',
  'actionlint.yml',
  '.shellcheckrc',
  '.prettierrc',
  '.eslintrc',
  '.eslintrc.json',
]

/** Files scanned for an explicit `.config/<path>` reference. */
const CALLER_GLOBS = [
  'Taskfile.yml',
  'taskfiles',
  '.github/workflows',
  '.config',
  '.devcontainer/scripts',
]

/** Directory names never worth walking. */
const EXCLUDED_DIRS = ['node_modules', '__pycache__', '.git']

/** Every file under `dir`, recursively, as paths relative to `dir`. */
function walkFiles(dir: string, base: string = dir): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...walkFiles(absolute, base))
      continue
    }
    found.push(relative(base, absolute).split('\\').join('/'))
  }
  return found
}

/** The concatenated text of every file that could name a config by path. */
function callerText(repoRoot: string): string {
  const chunks: string[] = []
  for (const entry of CALLER_GLOBS) {
    const absolute = join(repoRoot, entry)
    if (!existsSync(absolute)) continue
    if (statSync(absolute).isDirectory()) {
      for (const rel of walkFiles(absolute)) {
        chunks.push(readFileSync(join(absolute, rel), 'utf8'))
      }
      continue
    }
    chunks.push(readFileSync(absolute, 'utf8'))
  }
  return chunks.join('\n')
}

/**
 * The other files in the same bucket, concatenated.
 *
 * Not every config is reached from a command line. A tool's own config may
 * name a companion file — cspell's dictionary is reached only through
 * `dictionaryDefinitions[].path` in `spelling/cspell.json` — and because that
 * path resolves against the config's own directory it is written `./musher.txt`,
 * never `.config/spelling/musher.txt`. Such a file has a caller; it is simply
 * a bucket-internal one. The lookup is deliberately confined to the same
 * bucket, so this cannot excuse an orphan elsewhere under `.config/`.
 */
function bucketSiblings(configDir: string, rel: string): string {
  if (!rel.includes('/')) return ''
  const bucket = join(configDir, rel.slice(0, rel.lastIndexOf('/')))
  const chunks: string[] = []
  for (const sibling of readdirSync(bucket, { withFileTypes: true })) {
    if (!sibling.isFile() || join(bucket, sibling.name) === join(configDir, rel)) continue
    chunks.push(readFileSync(join(bucket, sibling.name), 'utf8'))
  }
  return chunks.join('\n')
}

/** The file names the index quotes in code spans, which is where it names them. */
function indexedNames(index: string): Set<string> {
  return new Set(Array.from(index.matchAll(/`([^`]+)`/g), (match) => match[1] as string))
}

/**
 * Every violation of the layout, as `CFG-NN: <what> — <fix>` messages.
 *
 * Exported and taking `repoRoot` so the test suite can exercise each rule
 * against a throwaway tree rather than against this repository.
 */
export function configViolations(repoRoot: string = REPO_ROOT): string[] {
  const problems: string[] = []
  const configDir = join(repoRoot, CONFIG_DIR)

  if (!existsSync(configDir) || !statSync(configDir).isDirectory()) {
    problems.push(
      `CFG-01: ${CONFIG_DIR}/ does not exist. Tool configuration lives there — see ` +
        'docs/adr/0011-tooling-configuration-layout.md.',
    )
    return problems
  }

  const indexPath = join(configDir, 'README.md')
  const hasIndex = existsSync(indexPath)
  if (!hasIndex) {
    problems.push(
      `CFG-02: ${CONFIG_DIR}/README.md is missing. It is the index: one row per file, ` +
        'naming its tool and the flag that reaches it.',
    )
  }
  const indexed = hasIndex ? indexedNames(readFileSync(indexPath, 'utf8')) : new Set<string>()
  const callers = callerText(repoRoot)

  for (const rel of walkFiles(configDir)) {
    const name = rel.split('/').pop() as string
    if (name === 'README.md' || LOCAL_OVERRIDES.includes(name)) continue

    if (name.startsWith('.')) {
      problems.push(
        `CFG-05: ${CONFIG_DIR}/${rel} has a leading dot. The directory is already dotted; ` +
          'a second dot advertises auto-discovery that is deliberately not in use.',
      )
    }

    const suffix = name.includes('.') ? `.${name.split('.').pop()}` : ''
    if (EXECUTABLE_SUFFIXES.includes(suffix)) {
      problems.push(
        `CFG-08: ${CONFIG_DIR}/${rel} is a program, not a declaration. A build asset ` +
          'belongs beside what builds it; a repo-level runner belongs in tools/src/.',
      )
    }

    if (!rel.includes('/') && !TOP_LEVEL_ALLOWED.includes(name)) {
      problems.push(
        `CFG-07: ${CONFIG_DIR}/${name} sits at the top level. Bucket it by concern: ` +
          `${CONFIG_DIR}/<concern>/${name}.`,
      )
    }

    if (hasIndex && !indexed.has(rel) && !indexed.has(name)) {
      problems.push(
        `CFG-03: ${CONFIG_DIR}/${rel} has no row in ${CONFIG_DIR}/README.md. A config ` +
          'the index does not name is invisible to the next reader.',
      )
    }

    const called =
      AUTO_DISCOVERED[name] !== undefined ||
      callers.includes(`${CONFIG_DIR}/${rel}`) ||
      bucketSiblings(configDir, rel).includes(name)
    if (!called) {
      problems.push(
        `CFG-04: ${CONFIG_DIR}/${rel} is named by no caller. Pass it explicitly with the ` +
          "tool's own config flag, or delete it — dead config still reads as authoritative.",
      )
    }
  }

  for (const name of SHADOWING) {
    if (!existsSync(join(repoRoot, name))) continue
    problems.push(
      `CFG-06: ${name} at the repo root shadows ${CONFIG_DIR}/lefthook.yml. Lefthook's ` +
        'search is first-match-wins, so a different set of hooks runs and nothing says so.',
    )
  }

  for (const name of STRAY_ROOT_CONFIGS) {
    if (!existsSync(join(repoRoot, name))) continue
    problems.push(
      `CFG-07: ${name} at the repo root belongs in ${CONFIG_DIR}/<concern>/, passed to ` +
        'its tool by path. Default discovery is what scattered these files to begin with.',
    )
  }

  // A file CFG-06 or CFG-07 already names is not reported a second time: the
  // finding that says where it belongs is the one worth reading.
  const named = new Set([...SHADOWING, ...STRAY_ROOT_CONFIGS])
  for (const name of rootEntries(repoRoot)) {
    if (ROOT_ENTRIES.includes(name) || named.has(name)) continue
    problems.push(
      `CFG-09: ${name} at the repo root is not in ROOT_ENTRIES (tools/src/lib/layout.ts). ` +
        'Move it under the directory that owns its concern, or gitignore it if it is ' +
        'build output. See docs/adr/0024.',
    )
  }

  return problems
}

/**
 * The top-level names of every path git tracks, staged ones included.
 *
 * Untracked paths do not count. The allowlist governs what the repository
 * holds, and a checkout also holds what runs in it: CI downloads actionlint's
 * archive into the workspace root before it lints, and local build output sits
 * there until `task clean`. Counting those failed a clean tree in CI.
 */
function rootEntries(repoRoot: string): string[] {
  const listing = git(repoRoot, ['ls-files', '-z', '--cached'])
  const names = listing
    .split('\0')
    .filter((path) => path !== '')
    .map((path) => path.split('/')[0] as string)
  return [...new Set(names)].sort()
}

function main(): void {
  const failures = new Failures()
  for (const problem of configViolations()) failures.add(problem)
  failures.report(`${CONFIG_DIR}/ layout and the repository root are intact (CFG-01..CFG-09).`)
}

if (import.meta.main) main()
