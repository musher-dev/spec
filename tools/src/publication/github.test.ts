/**
 * The fetch-backed release source, against a recorded conversation rather than
 * the network.
 */
import { describe, expect, test } from 'bun:test'
import { type FetchLike, GitHubReleaseSource, resolveRepository } from './github.ts'

interface Seen {
  url: string
  headers: Record<string, string>
}

function fake(routes: Record<string, () => Response>): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = []
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
    const route = routes[url]
    return route === undefined ? new Response('not found', { status: 404 }) : route()
  }
  return { fetch, seen }
}

const API = 'https://api.test'

describe('GitHubReleaseSource', () => {
  test('reads a published release from the tags endpoint, authenticated when a token exists', async () => {
    const { fetch, seen } = fake({
      [`${API}/repos/o/r/releases/tags/component/v1.0.0`]: () =>
        Response.json({
          tag_name: 'component/v1.0.0',
          draft: false,
          immutable: true,
          assets: [
            {
              name: 'component.schema.json',
              digest: `sha256:${'a'.repeat(64)}`,
              url: `${API}/a/1`,
            },
            { name: 'component-v1.0.0.tar.gz', digest: null, url: `${API}/a/2` },
          ],
        }),
    })
    const source = new GitHubReleaseSource({ repository: 'o/r', token: 't0k', api: API, fetch })
    expect(await source.publishedRelease('component/v1.0.0')).toEqual({
      tag: 'component/v1.0.0',
      draft: false,
      immutable: true,
      assets: [
        { name: 'component.schema.json', digest: `sha256:${'a'.repeat(64)}`, url: `${API}/a/1` },
        { name: 'component-v1.0.0.tar.gz', digest: null, url: `${API}/a/2` },
      ],
    })
    expect(seen[0]?.headers.Authorization).toBe('Bearer t0k')
  })

  test('a 404 means not published; any other failure throws', async () => {
    const { fetch } = fake({
      [`${API}/repos/o/r/releases/tags/core/v1.0.0`]: () => new Response('boom', { status: 502 }),
    })
    const source = new GitHubReleaseSource({ repository: 'o/r', token: null, api: API, fetch })
    expect(await source.publishedRelease('component/v1.0.0')).toBeNull()
    expect(source.publishedRelease('core/v1.0.0')).rejects.toThrow(/502/)
  })

  test('unauthenticated requests carry no Authorization header', async () => {
    const { fetch, seen } = fake({})
    const source = new GitHubReleaseSource({ repository: 'o/r', token: null, api: API, fetch })
    await source.publishedRelease('component/v1.0.0')
    expect(seen[0]?.headers.Authorization).toBeUndefined()
  })

  test('lists every page of releases', async () => {
    const release = (n: number) => ({
      tag_name: `x/v1.0.${n}`,
      draft: false,
      immutable: true,
      assets: [],
    })
    const { fetch } = fake({
      [`${API}/repos/o/r/releases?per_page=100&page=1`]: () =>
        Response.json(Array.from({ length: 100 }, (_, n) => release(n))),
      [`${API}/repos/o/r/releases?per_page=100&page=2`]: () => Response.json([release(100)]),
    })
    const source = new GitHubReleaseSource({ repository: 'o/r', token: null, api: API, fetch })
    expect((await source.listReleases()).length).toBe(101)
  })

  test('downloads through the redirect without sending the token onward', async () => {
    const { fetch, seen } = fake({
      [`${API}/a/1`]: () =>
        new Response(null, { status: 302, headers: { location: 'https://storage.test/blob' } }),
      'https://storage.test/blob': () => new Response('bytes'),
    })
    const source = new GitHubReleaseSource({ repository: 'o/r', token: 't0k', api: API, fetch })
    const bytes = await source.download({
      name: 'component.schema.json',
      digest: null,
      url: `${API}/a/1`,
    })
    expect(bytes.toString()).toBe('bytes')
    expect(seen[0]?.headers.Accept).toBe('application/octet-stream')
    expect(seen[1]?.headers.Authorization).toBeUndefined()
  })
})

describe('resolveRepository', () => {
  test('prefers GITHUB_REPOSITORY and otherwise derives it from REPO_URL', () => {
    expect(resolveRepository({ GITHUB_REPOSITORY: 'someone/fork' })).toBe('someone/fork')
    expect(resolveRepository({})).toBe('musher-dev/specifications')
    expect(() => resolveRepository({ GITHUB_REPOSITORY: 'not a repo' })).toThrow()
  })
})
