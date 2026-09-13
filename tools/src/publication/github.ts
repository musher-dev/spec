/**
 * The GitHub releases a deploy verifies, behind an interface a test can fake.
 *
 * `publishedRelease` uses `GET /repos/{owner}/{repo}/releases/tags/{tag}`,
 * which returns published releases only: a 404 means "not published", whether
 * the release is a draft or absent. `listReleases` pages through every release,
 * drafts included when the token can see them. `download` fetches an asset's
 * bytes through the API, so it works for a private repository too.
 *
 * Credentials: `GITHUB_TOKEN`, else `gh auth token`, else none — enough for a
 * public repository within the unauthenticated rate limit.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { spawnSync } from 'node:child_process'
import { REPO_URL } from '../lib/layout.ts'

export interface ReleaseAsset {
  readonly name: string
  /** `sha256:<hex>` as GitHub records it, or null when it records none. */
  readonly digest: string | null
  /** Where `download` reads the bytes from. */
  readonly url: string
}

export interface PublishedRelease {
  readonly tag: string
  readonly draft: boolean
  readonly immutable: boolean
  readonly assets: readonly ReleaseAsset[]
}

export interface ReleaseSource {
  /** The published release for a tag, or null when none is published. */
  publishedRelease(tag: string): Promise<PublishedRelease | null>
  listReleases(): Promise<PublishedRelease[]>
  download(asset: ReleaseAsset): Promise<Buffer>
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const API = 'https://api.github.com'
/** Every request gives up after this long, so a stalled connection fails the job rather than hanging it. */
export const REQUEST_TIMEOUT_MS = 30_000
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** `GITHUB_TOKEN`, else `gh auth token`, else null. */
export function resolveToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.GITHUB_TOKEN
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
  // No gh, or gh not logged in: both mean "no token", and the request goes out
  // unauthenticated. Anything the API then refuses fails loudly there.
  if (gh.error !== undefined || gh.status !== 0) return null
  const token = gh.stdout.trim()
  return token === '' ? null : token
}

/** `owner/repo`: `GITHUB_REPOSITORY`, else derived from `REPO_URL`. */
export function resolveRepository(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.GITHUB_REPOSITORY
  if (fromEnv !== undefined && fromEnv !== '') {
    if (!REPOSITORY.test(fromEnv))
      throw new Error(`GITHUB_REPOSITORY is not owner/repo: ${fromEnv}`)
    return fromEnv
  }
  const derived = new URL(REPO_URL).pathname.replace(/^\/|\/$/g, '')
  if (!REPOSITORY.test(derived)) throw new Error(`cannot derive owner/repo from ${REPO_URL}`)
  return derived
}

interface ApiRelease {
  tag_name?: unknown
  draft?: unknown
  immutable?: unknown
  assets?: unknown
}

function toRelease(raw: ApiRelease): PublishedRelease {
  if (typeof raw.tag_name !== 'string' || !Array.isArray(raw.assets)) {
    throw new Error('GitHub returned a release without tag_name or assets')
  }
  return {
    tag: raw.tag_name,
    draft: raw.draft === true,
    immutable: raw.immutable === true,
    assets: raw.assets.map((asset: { name?: unknown; digest?: unknown; url?: unknown }) => {
      if (typeof asset.name !== 'string' || typeof asset.url !== 'string') {
        throw new Error(`GitHub returned an asset without name or url on ${raw.tag_name}`)
      }
      return {
        name: asset.name,
        digest: typeof asset.digest === 'string' ? asset.digest : null,
        url: asset.url,
      }
    }),
  }
}

export class GitHubReleaseSource implements ReleaseSource {
  private readonly repository: string
  private readonly token: string | null
  private readonly api: string
  private readonly fetch: FetchLike

  constructor(options: {
    readonly repository: string
    readonly token: string | null
    readonly api?: string
    readonly fetch?: FetchLike
  }) {
    this.repository = options.repository
    this.token = options.token
    this.api = options.api ?? API
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init))
  }

  static fromEnvironment(): GitHubReleaseSource {
    return new GitHubReleaseSource({ repository: resolveRepository(), token: resolveToken() })
  }

  private headers(accept: string): Record<string, string> {
    return {
      Accept: accept,
      'User-Agent': 'musher-specifications-tools',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(this.token === null ? {} : { Authorization: `Bearer ${this.token}` }),
    }
  }

  private async getJson(path: string): Promise<{ status: number; body: unknown }> {
    const url = `${this.api}/repos/${this.repository}${path}`
    const response = await this.fetch(url, {
      headers: this.headers('application/vnd.github+json'),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 404) return { status: 404, body: null }
    if (!response.ok) {
      throw new Error(`GET ${url} failed (${response.status}) — ${await response.text()}`)
    }
    return { status: response.status, body: await response.json() }
  }

  async publishedRelease(tag: string): Promise<PublishedRelease | null> {
    const path = tag.split('/').map(encodeURIComponent).join('/')
    const { status, body } = await this.getJson(`/releases/tags/${path}`)
    return status === 404 ? null : toRelease(body as ApiRelease)
  }

  async listReleases(): Promise<PublishedRelease[]> {
    const releases: PublishedRelease[] = []
    for (let page = 1; ; page += 1) {
      const { status, body } = await this.getJson(`/releases?per_page=100&page=${page}`)
      if (status === 404) throw new Error(`${this.repository}: repository not found`)
      if (!Array.isArray(body)) throw new Error('GitHub returned a non-array release list')
      releases.push(...body.map((raw) => toRelease(raw as ApiRelease)))
      if (body.length < 100) return releases
    }
  }

  async download(asset: ReleaseAsset): Promise<Buffer> {
    // The API answers with a redirect to storage. Follow it by hand, without
    // the Authorization header, which must not travel to another origin.
    const first = await this.fetch(asset.url, {
      headers: this.headers('application/octet-stream'),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    let response = first
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get('location')
      if (location === null) throw new Error(`${asset.name}: redirect without a location`)
      response = await this.fetch(location, {
        headers: { 'User-Agent': 'musher-specifications-tools' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    }
    if (!response.ok) {
      throw new Error(`download of ${asset.name} failed (${response.status})`)
    }
    return Buffer.from(await response.arrayBuffer())
  }
}
