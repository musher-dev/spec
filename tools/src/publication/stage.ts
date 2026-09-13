/**
 * Stage the files a release attaches — `task release:stage TAG=<tag>`
 * (docs/adr/0023 §2, §6).
 *
 * Runs in the release job, checked out at the tag, on the tag's own tooling.
 * Before staging anything it refuses unless:
 *
 *   - the tag exists and its ledger entry is the working tree's, verbatim;
 *   - `<tag>:<path>` has the recorded tree id;
 *   - a kind family passes the tagged core gate, and the pinned bundle it
 *     builds at the tag hashes to `bundleSha256` — a determinism assertion,
 *     since `record` hashed the same tree;
 *   - core records `bundleSha256: null` and carries no `schemas/src`.
 *
 * A kind family stages `<family>.schema.json` and `<family>-v<X.Y.Z>.tar.gz`.
 * The archive's root `<family>-v<major>/` holds the bundle, `spec.md`,
 * `examples/`, `conformance/` with the fixture contract `conformance/README.md`,
 * `core/spec.md` and `core/conformance/` read from `core/v<requires.core>` —
 * not from the family tag, which may differ by non-releasable core commits —
 * `LICENSE`, `NOTICE`, and `release.json`. Core stages only its archive.
 *
 * Every file is read out of git at a tag, never from the working tree. The
 * archive is deterministic: sorted names, owner and group 0, a fixed mtime, and
 * `gzip -n`, with the flags the release workflow has always used.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { listTreeFiles, readBlobAtRef, tagCommit, tagExists, treeId } from '../lib/git.ts'
import {
  CONFORMANCE_README,
  CORE_FAMILY,
  canonicalJson,
  Failures,
  familyPaths,
  inRepo,
  type Json,
  LICENSE_FILE,
  NOTICE_FILE,
  RELEASE_STAGE_DIR,
  REPO_ROOT,
  releaseDirPaths,
} from '../lib/layout.ts'
import { pinnedBundle } from '../schema/bundle.ts'
import { gitReader } from '../schema/sources.ts'
import { assertCoreGateTagged } from './core-gate.ts'
import { ledgerAtRef, readLedger, sameEntry } from './ledger.ts'
import { assetNames, isCore, parseReleaseTag, releaseTag, sha256 } from './releases.ts'

export interface StagedFile {
  readonly name: string
  readonly path: string
  readonly sha256: string
}

/** A release that must not be staged. Nothing was written to the output directory. */
export class StageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StageError'
  }
}

/** Where core's files sit inside a kind family archive. */
const CORE_MEMBER = CORE_FAMILY
const RELEASE_MANIFEST = 'release.json'

/** Copy every file under `from` at `ref` to `to`, keeping relative paths. Returns the count. */
function extractTree(repoRoot: string, ref: string, from: string, to: string): number {
  const files = listTreeFiles(repoRoot, ref, from)
  for (const file of files) {
    const bytes = readBlobAtRef(repoRoot, ref, file)
    if (bytes === null) throw new StageError(`${ref}: listed ${file} but could not read it`)
    writeMember(join(to, ...file.slice(from.length + 1).split('/')), bytes)
  }
  return files.length
}

function requireTree(repoRoot: string, ref: string, from: string, to: string): void {
  if (extractTree(repoRoot, ref, from, to) === 0) {
    throw new StageError(`${ref}: ${from} is empty or absent, and every release carries it`)
  }
}

function requireFile(repoRoot: string, ref: string, from: string, to: string): void {
  const bytes = readBlobAtRef(repoRoot, ref, from)
  if (bytes === null) throw new StageError(`${ref}: ${from} does not exist at that ref`)
  writeMember(to, bytes)
}

function writeMember(path: string, bytes: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

/**
 * Fix every mode, so the archive does not carry the runner's umask. Files
 * 0644, directories 0755 — an archive of data, with nothing executable.
 */
function normalizeModes(dir: string): void {
  chmodSync(dir, 0o755)
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) normalizeModes(path)
    else chmodSync(path, 0o644)
  }
}

/** `tar … | gzip -n -9`, byte for byte what the release workflow ran. */
export function deterministicArchive(parent: string, root: string): Buffer {
  const epoch = process.env.SOURCE_DATE_EPOCH ?? '0'
  if (!/^\d+$/.test(epoch)) throw new StageError(`SOURCE_DATE_EPOCH must be an integer: ${epoch}`)
  const maxBuffer = 1024 * 1024 * 1024
  const tar = spawnSync(
    'tar',
    [
      '--format=gnu',
      '--sort=name',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      `--mtime=@${epoch}`,
      '-cf',
      '-',
      '-C',
      parent,
      root,
    ],
    { maxBuffer, env: { ...process.env, LC_ALL: 'C' } },
  )
  if (tar.error !== undefined) throw new StageError(`tar could not be run — ${tar.error.message}`)
  if (tar.status !== 0) throw new StageError(`tar failed (${tar.status}) — ${tar.stderr}`)
  const gzip = spawnSync('gzip', ['-n', '-9'], { input: tar.stdout, maxBuffer })
  if (gzip.error !== undefined)
    throw new StageError(`gzip could not be run — ${gzip.error.message}`)
  if (gzip.status !== 0) throw new StageError(`gzip failed (${gzip.status}) — ${gzip.stderr}`)
  return gzip.stdout
}

export function stageRelease(repoRoot: string, tag: string, outDir: string): StagedFile[] {
  const release = parseReleaseTag(tag)
  if (release === null) throw new StageError(`${tag} is not a release tag`)
  if (!tagExists(repoRoot, tag)) throw new StageError(`${tag} does not exist`)

  const ledger = readLedger(repoRoot)
  const entry = ledger.releases[tag]
  if (entry === undefined) throw new StageError(`${tag} is not recorded in the working ledger`)
  const atTag = ledgerAtRef(repoRoot, tag)
  const own = atTag.version === 2 ? atTag.releases[tag] : undefined
  if (own === undefined) throw new StageError(`${tag}: the tag's own ledger does not record it`)
  if (!sameEntry(own, entry)) {
    throw new StageError(`${tag}: the tag's ledger entry differs from the working tree's`)
  }

  const tree = treeId(repoRoot, tag, entry.path)
  if (tree !== entry.tree) {
    throw new StageError(
      `${tag}: ${entry.path} has tree ${tree ?? '<absent>'} at the tag, but the ledger records ${entry.tree}`,
    )
  }

  const dir = releaseDirPaths(entry.path)
  const names = assetNames(release)
  const rootName = `${release.family}-${release.major}`
  const staging = mkdtempSync(join(tmpdir(), 'musher-stage-'))
  const root = join(staging, rootName)
  const commit = tagCommit(repoRoot, tag)
  let bundle: string | null = null

  try {
    if (isCore(release.family)) {
      if (entry.bundleSha256 !== null) {
        throw new StageError(`${tag}: core publishes no schema, so bundleSha256 must be null`)
      }
      if (listTreeFiles(repoRoot, tag, dir.src).length > 0) {
        throw new StageError(`${tag}: core publishes no schema, but ${dir.src} exists at the tag`)
      }
      writeMember(join(root, RELEASE_MANIFEST), canonicalJson({ tag, commit }))
    } else {
      const requires = entry.requires
      if (requires === undefined || entry.bundleSha256 === null) {
        throw new StageError(`${tag}: a kind family entry needs bundleSha256 and requires.core`)
      }
      const failures = new Failures()
      assertCoreGateTagged(repoRoot, tag, requires.core, failures, entry.path)
      if (failures.count > 0) throw new StageError(failures.messages.join('\n'))

      if (entry.path !== familyPaths(release.family, release.major).dir) {
        throw new StageError(
          `${tag}: recorded at ${entry.path}, but this tooling builds ${release.family} ` +
            `${release.major} from ${familyPaths(release.family, release.major).dir}. Stage ` +
            "a release with its own tag's tooling.",
        )
      }
      bundle = pinnedBundle(
        { name: release.family, major: release.major, repoRoot },
        release.version,
        {
          reader: gitReader(repoRoot, tag),
        },
      )
      if (bundle === null) throw new StageError(`${tag}: no schema modules at ${dir.src}`)
      const actual = sha256(bundle)
      if (actual !== entry.bundleSha256) {
        throw new StageError(
          `${tag}: the pinned bundle built at the tag hashes to ${actual}, but the ledger ` +
            `records ${entry.bundleSha256}. The build is not deterministic, or the tooling ` +
            'differs from the one that recorded it.',
        )
      }

      const coreTag = releaseTag(CORE_FAMILY, requires.core)
      const coreLine = `v${requires.core.split('.')[0]}`
      const corePath = ledger.releases[coreTag]?.path ?? familyPaths(CORE_FAMILY, coreLine).dir
      const coreDir = releaseDirPaths(corePath)
      writeMember(join(root, names.bundle), bundle)
      extractTree(repoRoot, tag, dir.examples, join(root, 'examples'))
      requireFile(repoRoot, coreTag, coreDir.spec, join(root, CORE_MEMBER, 'spec.md'))
      requireTree(repoRoot, coreTag, coreDir.conformance, join(root, CORE_MEMBER, 'conformance'))
      const manifest: Json = {
        tag,
        commit,
        requires: { core: requires.core },
        bundleSha256: entry.bundleSha256,
        coreTag,
        coreCommit: tagCommit(repoRoot, coreTag),
      }
      writeMember(join(root, RELEASE_MANIFEST), canonicalJson(manifest))
    }

    requireFile(repoRoot, tag, dir.spec, join(root, 'spec.md'))
    requireTree(repoRoot, tag, dir.conformance, join(root, 'conformance'))
    requireFile(repoRoot, tag, CONFORMANCE_README, join(root, ...CONFORMANCE_README.split('/')))
    requireFile(repoRoot, tag, LICENSE_FILE, join(root, LICENSE_FILE))
    requireFile(repoRoot, tag, NOTICE_FILE, join(root, NOTICE_FILE))

    normalizeModes(root)
    const archive = deterministicArchive(staging, rootName)

    mkdirSync(outDir, { recursive: true })
    const staged: StagedFile[] = []
    if (bundle !== null) {
      const path = join(outDir, names.bundle)
      writeFileSync(path, bundle, 'utf8')
      staged.push({ name: names.bundle, path, sha256: sha256(bundle) })
    }
    const archivePath = join(outDir, names.archive)
    writeFileSync(archivePath, archive)
    staged.push({ name: names.archive, path: archivePath, sha256: sha256(archive) })
    return staged
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function main(): void {
  const [tag, out] = process.argv.slice(2)
  if (tag === undefined || tag === '') {
    console.error('Usage: bun src/publication/stage.ts <family>/v<X.Y.Z> [out-dir]')
    process.exit(2)
  }
  let staged: StagedFile[]
  try {
    staged = stageRelease(REPO_ROOT, tag, out ?? inRepo(REPO_ROOT, RELEASE_STAGE_DIR))
  } catch (error) {
    if (!(error instanceof StageError)) throw error
    for (const line of error.message.split('\n')) console.error(`  ✗ ${line}`)
    process.exit(1)
  }
  // `sha256sum` format, so the release job can compare and attest directly.
  for (const file of staged) console.log(`${file.sha256}  ${file.name}`)
}

if (import.meta.main) main()
