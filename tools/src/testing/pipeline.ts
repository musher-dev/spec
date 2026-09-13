/**
 * The release pipeline, run locally against a `FixtureRepo`.
 *
 * Each step is the one CI runs: sources committed, `record` on the release
 * branch, the ledger committed, a tag at that commit, `stageRelease` at the
 * tag, the staged files published as an immutable release, and `fetchReleases`
 * verifying them into the cache the site reads. A test that needs a released
 * version goes through all of it, so no test can pass against a shortcut the
 * pipeline does not take.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORE_FAMILY, familyPaths, type Json } from '../lib/layout.ts'
import { fetchReleases } from '../publication/fetch.ts'
import { record } from '../publication/record.ts'
import { stageRelease } from '../publication/stage.ts'
import type { FixtureRepo } from './fixture.ts'
import { FakeReleaseSource } from './release-source.ts'

const CORE = familyPaths(CORE_FAMILY, 'v1')

/** A fixture repository's release pipeline: its fake GitHub and its asset cache. */
export class Pipeline {
  readonly source = new FakeReleaseSource()
  readonly cacheDir: string

  constructor(readonly fx: FixtureRepo) {
    this.cacheDir = join(fx.root, '.cache', 'releases')
    fx.writeRepositoryFiles()
    // What the pipeline and the site write must never ride into a fixture commit.
    fx.writeFile('.gitignore', '/.cache/\n/site*/\n')
  }

  /** Record, commit the ledger, and tag — the release pull request and its merge. */
  recordAndTag(tag: string): void {
    record(this.fx.root)
    this.fx.commit(`chore(repo): release ${tag}`)
    this.fx.tag(tag)
  }

  /** Stage a tagged release and publish the staged files as an immutable release. */
  publish(tag: string): string {
    const out = mkdtempSync(join(tmpdir(), 'musher-staged-'))
    try {
      stageRelease(this.fx.root, tag, out, { baseLedgerRef: 'main' })
      this.source.publishDir(tag, out)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
    return tag
  }

  /** Release core: prose and corpus, recorded, tagged, published. */
  releaseCore(version: string, prose?: string): string {
    const tag = `${CORE_FAMILY}/v${version}`
    if (prose !== undefined) this.fx.writeFile(CORE.spec, prose)
    this.fx.writeCoreSkeleton('v1')
    this.fx.setManifestVersion(CORE.manifestKey, version)
    this.fx.commit(`feat(core): core ${version}`)
    this.recordAndTag(tag)
    return this.publish(tag)
  }

  /**
   * Release a kind family version. Releases core 1.0.0 first when no core has
   * been released, because the core gate requires it.
   */
  releaseKind(
    family: string,
    major: string,
    version: string,
    doc: Json,
    options: {
      readonly prose?: string
      readonly skeleton?: boolean
      /** False to stop at the tag, before anything is staged or published. */
      readonly publish?: boolean
    } = {},
  ): string {
    if (!this.fx.hasTag(`${CORE_FAMILY}/v1.0.0`)) this.releaseCore('1.0.0')
    const paths = familyPaths(family, major)
    if (options.skeleton !== false) this.fx.writeFamilySkeleton(family, major)
    if (options.prose !== undefined || !this.fx.hasBindings(paths.spec)) {
      // Keep prose a test already wrote; add the §2 the core gate reads.
      const absolute = join(this.fx.root, paths.spec)
      const existing = existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined
      this.fx.writeFile(paths.spec, this.fx.kindSpec(family, options.prose ?? existing))
    }
    this.fx.writeSources(family, major, doc)
    this.fx.setManifestVersion(paths.manifestKey, version)
    this.fx.commit(`feat(${family}): ${family} ${version}`)
    const tag = `${family}/v${version}`
    this.recordAndTag(tag)
    return options.publish === false ? tag : this.publish(tag)
  }

  /** Verify every published release into the cache, failing the test on any refusal. */
  async fetch(): Promise<void> {
    const result = await fetchReleases(this.fx.root, this.source, this.cacheDir)
    if (result.failures.length > 0) throw new Error(result.failures.join('\n'))
  }
}
