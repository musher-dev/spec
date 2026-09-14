/**
 * An in-memory stand-in for GitHub releases.
 *
 * Every property `fetch.ts` refuses on has a toggle here — a draft, a release
 * that is not immutable, a digest GitHub recorded wrongly, bytes that differ
 * from their digest, a missing asset — so each refusal is a test rather than a
 * hope. `calls` records what was asked, so a test can prove a cache hit asked
 * nothing.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PublishedRelease, ReleaseAsset, ReleaseSource } from '../publication/github.ts'

interface FakeAsset {
  bytes: Buffer
  digest: string | null
}

interface FakeRelease {
  draft: boolean
  immutable: boolean
  assets: Map<string, FakeAsset>
}

function digestOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export class FakeReleaseSource implements ReleaseSource {
  readonly calls: string[] = []
  private readonly releases = new Map<string, FakeRelease>()

  /** Publish a release, immutable and not a draft unless told otherwise. */
  publish(
    tag: string,
    files: { readonly [name: string]: Buffer | string },
    options: { readonly draft?: boolean; readonly immutable?: boolean } = {},
  ): this {
    const assets = new Map<string, FakeAsset>()
    for (const [name, contents] of Object.entries(files)) {
      const bytes = Buffer.from(contents)
      assets.set(name, { bytes, digest: digestOf(bytes) })
    }
    this.releases.set(tag, {
      draft: options.draft ?? false,
      immutable: options.immutable ?? true,
      assets,
    })
    return this
  }

  /** Publish every file in a directory — what `stageRelease` wrote — as the release's assets. */
  publishDir(tag: string, dir: string, names?: readonly string[]): this {
    const files: { [name: string]: Buffer } = {}
    for (const name of names ?? readdirSync(dir)) files[name] = readFileSync(join(dir, name))
    return this.publish(tag, files)
  }

  private release(tag: string): FakeRelease {
    const found = this.releases.get(tag)
    if (found === undefined) throw new Error(`fake: no release ${tag}`)
    return found
  }

  private asset(tag: string, name: string): FakeAsset {
    const found = this.release(tag).assets.get(name)
    if (found === undefined) throw new Error(`fake: ${tag} has no asset ${name}`)
    return found
  }

  setDraft(tag: string, draft: boolean): this {
    this.release(tag).draft = draft
    return this
  }

  setImmutable(tag: string, immutable: boolean): this {
    this.release(tag).immutable = immutable
    return this
  }

  /** Record a different digest without changing the bytes. */
  setDigest(tag: string, name: string, digest: string | null): this {
    this.asset(tag, name).digest = digest
    return this
  }

  /** Serve different bytes under the digest already recorded. */
  setBytes(tag: string, name: string, bytes: Buffer | string): this {
    this.asset(tag, name).bytes = Buffer.from(bytes)
    return this
  }

  removeAsset(tag: string, name: string): this {
    this.release(tag).assets.delete(name)
    return this
  }

  private view(tag: string, release: FakeRelease): PublishedRelease {
    return {
      tag,
      draft: release.draft,
      immutable: release.immutable,
      assets: [...release.assets.entries()].map(([name, asset]) => ({
        name,
        digest: asset.digest,
        url: `fake://${tag}/${name}`,
      })),
    }
  }

  async publishedRelease(tag: string): Promise<PublishedRelease | null> {
    this.calls.push(`release ${tag}`)
    const release = this.releases.get(tag)
    return release === undefined ? null : this.view(tag, release)
  }

  async listReleases(): Promise<PublishedRelease[]> {
    this.calls.push('list')
    return [...this.releases.entries()].map(([tag, release]) => this.view(tag, release))
  }

  async download(asset: ReleaseAsset): Promise<Buffer> {
    this.calls.push(`download ${asset.url}`)
    const match = /^fake:\/\/(.+)\/([^/]+)$/.exec(asset.url)
    if (match?.[1] === undefined || match[2] === undefined) throw new Error(`fake: ${asset.url}`)
    return Buffer.from(this.asset(match[1], match[2]).bytes)
  }
}
