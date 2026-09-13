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
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { git } from '../lib/git.ts'
import {
  CORE_FAMILY,
  canonicalJson,
  familyPaths,
  type Json,
  LEDGER_FILE,
  RELEASE_PLEASE_MANIFEST_FILE,
} from '../lib/layout.ts'

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

  setLedger(ledger: Json): void {
    this.writeFile(LEDGER_FILE, canonicalJson(ledger))
  }

  commit(message: string): void {
    git(this.root, ['add', '-A'])
    git(this.root, [...IDENTITY, 'commit', '-m', message, '--quiet'])
  }

  tag(name: string): void {
    git(this.root, [...IDENTITY, 'tag', name])
  }

  head(): string {
    return git(this.root, ['rev-parse', 'HEAD'])
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true })
  }
}
