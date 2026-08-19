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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { git } from '../git.ts'
import { canonicalJson, type Json } from '../spec.ts'

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

  /** Delete a file relative to the repository root. */
  remove(path: string): void {
    rmSync(join(this.root, path), { force: true })
  }

  /** Write a family's committed bundle, at the layout the tooling expects. */
  writeBundle(family: string, major: string, doc: Json): string {
    const path = join('specifications', family, major, 'schemas', 'dist', `${family}.schema.json`)
    this.writeFile(path, canonicalJson(doc))
    return path
  }

  /** A minimal but realistic bundle — alias `$id`, as the bundler emits. */
  bundleDoc(family: string, major: string, extra: { [k: string]: Json } = {}): Json {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `https://schemas.musher.dev/${family}/${major}/${family}.schema.json`,
      title: `Musher ${family} Document`,
      type: 'object',
      ...extra,
    }
  }

  setManifest(entries: { [path: string]: string }): void {
    this.writeFile(join('.github', 'release-please', 'manifest.json'), canonicalJson(entries))
  }

  setLedger(ledger: Json): void {
    this.writeFile('published.json', canonicalJson(ledger))
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
