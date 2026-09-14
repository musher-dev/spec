/**
 * A throwaway git repository for exercising the publication pipeline.
 *
 * The site assembler reads releases out of tags, so proving that a published
 * version stays put needs a repository with a history — one where a bundle can
 * be tagged, then changed on the branch, and the pinned copy checked for
 * movement. Building that against the real repository is not an option, so
 * `git.ts` threads `repoRoot` through every call and this creates a real but
 * disposable one.
 *
 * Git config is neutralised (`git.ts` already sets `GIT_CONFIG_GLOBAL`), and
 * identity and signing are passed per-commit, so a developer's global config,
 * signing key, or hook path cannot change what these tests do.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { git } from '../lib/git.ts'
import {
  CONFORMANCE_FORMAT_FILE,
  CORE_FAMILY,
  canonicalJson,
  familyPaths,
  type Json,
  LEDGER_FILE,
  LICENSE_FILE,
  NOTICE_FILE,
  RELEASE_PLEASE_CONFIG_FILE,
  RELEASE_PLEASE_MANIFEST_FILE,
  readJson,
} from '../lib/layout.ts'

/** The changelog sections this repository configures: feat, fix and docs visible. */
export const RELEASE_SECTIONS: readonly { type: string; hidden?: boolean }[] = [
  { type: 'feat' },
  { type: 'fix' },
  { type: 'docs' },
  { type: 'perf', hidden: true },
  { type: 'chore', hidden: true },
  { type: 'refactor', hidden: true },
  { type: 'test', hidden: true },
  { type: 'ci', hidden: true },
  { type: 'build', hidden: true },
  { type: 'style', hidden: true },
]

const IDENTITY = [
  '-c',
  'user.name=Fixture',
  '-c',
  'user.email=fixture@example.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'tag.gpgsign=false',
]

export class FixtureRepo {
  readonly root: string

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'musher-spec-'))
    git(this.root, ['init', '-b', 'main', '--quiet'])
  }

  /** Write a file relative to the repository root. */
  writeFile(path: string, contents: string): void {
    const absolute = join(this.root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents, 'utf8')
  }

  /** Delete a file or directory relative to the repository root. */
  remove(path: string): void {
    rmSync(join(this.root, path), { recursive: true, force: true })
  }

  /**
   * Write a family's root schema module under `schemas/src`, which is all a
   * bundle is built from. With `bundleDoc` as the module, the built bundle is
   * exactly `canonicalJson(bundleDoc(…))`: the bundler sets the same `$schema`
   * and alias `$id` the document already carries.
   */
  writeSources(family: string, major: string, rootModule: Json): string {
    const path = `${familyPaths(family, major).src}/${family}.schema.json`
    this.writeFile(path, canonicalJson(rootModule))
    return path
  }

  /**
   * Give a family version every part the layout says a release carries — prose,
   * an example, a conformance index — without overwriting any a test wrote.
   *
   * A released tag missing one of them fails loudly, so a test that cuts a
   * release to exercise something else has to carry them.
   */
  writeFamilySkeleton(family: string, major: string): void {
    const paths = familyPaths(family, major)
    const parts: [string, string, string][] = [
      [paths.spec, paths.spec, '## <a id="scope"></a>1. Scope\n'],
      [paths.examples, `${paths.examples}/minimal.yaml`, 'kind: COMPONENT\n'],
      [paths.conformance, `${paths.conformance}/cases.json`, canonicalJson({ cases: [] })],
    ]
    for (const [part, file, contents] of parts) {
      if (!existsSync(join(this.root, part))) this.writeFile(file, contents)
    }
  }

  /**
   * Give the base family every part the layout says it carries — prose and a
   * conformance index — and nothing else: no `schemas/`, no `examples/`. Core
   * ships neither (docs/adr/0022), so a fixture that wrote them would be testing
   * a tree the lint rejects.
   */
  writeCoreSkeleton(major = 'v1', prose = '## <a id="scope"></a>1. Core scope\n'): void {
    const paths = familyPaths(CORE_FAMILY, major)
    if (!existsSync(join(this.root, paths.spec))) this.writeFile(paths.spec, prose)
    if (!existsSync(join(this.root, paths.conformance))) {
      this.writeFile(`${paths.conformance}/cases.json`, canonicalJson({ cases: [] }))
    }
  }

  /** A minimal but realistic bundle — alias `$id`, as the bundler emits. Also a valid root module. */
  bundleDoc(family: string, major: string, extra: { [k: string]: Json } = {}): Json {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `https://specifications.musher.dev/${family}/${major}/${family}.schema.json`,
      title: `Musher ${family} Document`,
      type: 'object',
      ...extra,
    }
  }

  setManifest(entries: { [path: string]: string }): void {
    this.writeFile(RELEASE_PLEASE_MANIFEST_FILE, canonicalJson(entries))
  }

  /** Set one package's manifest version, keeping the others. */
  setManifestVersion(key: string, version: string): void {
    const path = join(this.root, RELEASE_PLEASE_MANIFEST_FILE)
    const current = existsSync(path) ? (readJson(path) as { [k: string]: string }) : {}
    this.setManifest({ ...current, [key]: version })
  }

  /** The release-please config the core gate reads its releasable types from. */
  writeReleaseConfig(
    sections: readonly { type: string; hidden?: boolean }[] = RELEASE_SECTIONS,
  ): void {
    this.writeFile(
      RELEASE_PLEASE_CONFIG_FILE,
      canonicalJson({
        'changelog-sections': sections.map((s) => ({ ...s, section: s.type })) as unknown as Json,
      }),
    )
  }

  /** The repository-level files every release archive carries. */
  writeRepositoryFiles(): void {
    this.writeFile(LICENSE_FILE, 'Apache License 2.0 (fixture)\n')
    this.writeFile(NOTICE_FILE, 'Fixture notice\n')
    this.writeFile(CONFORMANCE_FORMAT_FILE, '# Conformance (fixture)\n')
    this.writeReleaseConfig()
  }

  /**
   * A kind family spec.md: `prose`, then a §2 carrying the bindings and
   * dependency tables the core gate reads the cited core line from.
   */
  kindSpec(family: string, prose = '## <a id="scope"></a>1. Scope\n', coreLine = 'v1'): string {
    return [
      prose.trimEnd(),
      '',
      '## <a id="envelope"></a>2. Envelope',
      '',
      '| Core parameter | This family |',
      '|---|---|',
      `| \`kind\` | \`${family.toUpperCase().replace(/-/g, '_')}\` |`,
      '| `metadata` | [§3](#metadata) |',
      '| Fields accepting `null` | none |',
      '| Item document | No — it sits inside an item |',
      '',
      '**Normative dependencies**',
      '',
      '| Specification | Line |',
      '|---|---|',
      `| [core](../../core/${coreLine}/spec.md) | ${coreLine} |`,
      '',
    ].join('\n')
  }

  setLedger(ledger: Json): void {
    this.writeFile(LEDGER_FILE, canonicalJson(ledger))
  }

  /** Commit everything. A `body` becomes the message body, where footers live. */
  commit(message: string, body?: string): void {
    git(this.root, ['add', '-A'])
    const bodyArgs = body === undefined ? [] : ['-m', body]
    git(this.root, [...IDENTITY, 'commit', '--allow-empty', '-m', message, ...bodyArgs, '--quiet'])
  }

  /** Create and switch to a branch at HEAD. */
  branch(name: string): void {
    git(this.root, ['checkout', '-q', '-b', name])
  }

  checkout(name: string): void {
    git(this.root, ['checkout', '-q', name])
  }

  /** Merge a branch with a merge commit, as a non-squash merge would. */
  merge(name: string, message: string): void {
    git(this.root, [...IDENTITY, 'merge', '--no-ff', '-q', '-m', message, name])
  }

  /** Git's tree id for a path at a ref. */
  treeId(ref: string, path: string): string {
    return git(this.root, ['rev-parse', `${ref}:${path}`])
  }

  tag(name: string): void {
    git(this.root, [...IDENTITY, 'tag', name])
  }

  /** Move a tag — which the release-tags ruleset forbids, and which a test forges to prove it is caught. */
  forceTag(name: string, ref: string): void {
    git(this.root, [...IDENTITY, 'tag', '-f', name, ref])
  }

  hasTag(name: string): boolean {
    return git(this.root, ['tag', '--list', name]) === name
  }

  /** Whether the spec at `path` already carries a §2 bindings section. */
  hasBindings(path: string): boolean {
    const absolute = join(this.root, path)
    return existsSync(absolute) && readFileSync(absolute, 'utf8').includes('<a id="envelope">')
  }

  head(): string {
    return git(this.root, ['rev-parse', 'HEAD'])
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true })
  }
}
