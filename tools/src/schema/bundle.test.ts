/**
 * The bundle is build output, so the build itself carries the guarantees a
 * committed file used to: the same sources give the same bytes wherever they
 * are read from, and the command a downstream consumer runs needs nothing
 * `bun install` provides.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { discoverKinds, familyPaths, REPO_ROOT } from '../lib/layout.ts'
import { FixtureRepo } from '../testing/fixture.ts'
import { buildBundle, ensureBundleFile, familyBundle, pinnedBundle } from './bundle.ts'
import { fsReader, gitReader, type ModuleReader } from './sources.ts'

const COMPONENT = familyPaths('component', 'v1')

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

/** A component with a root module, a second module, and a cross-reference. */
function sources(): { fx: FixtureRepo; family: { name: string; major: string; repoRoot: string } } {
  const fx = new FixtureRepo()
  repo = fx
  fx.writeSources('component', 'v1', {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://specifications.musher.dev/component/v1/component',
    title: 'Musher Component Document',
    type: 'object',
    properties: { spec: { $ref: '#/$defs/ComponentWorkload' }, name: { $ref: '#/$defs/Name' } },
    $defs: { Name: { type: 'string', pattern: '^[a-z]+$' } },
  })
  fx.writeFile(
    `${COMPONENT.src}/component-workload.schema.json`,
    `${JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://specifications.musher.dev/component/v1/component-workload',
      type: 'object',
      properties: { port: { $ref: '#/$defs/Port' } },
      $defs: { Port: { type: 'integer', minimum: 1 } },
    })}\n`,
  )
  fx.writeFile(`${COMPONENT.src}/README.txt`, 'not a module\n')
  fx.commit('feat(component): sources')
  return { fx, family: { name: 'component', major: 'v1', repoRoot: fx.root } }
}

function reversed(reader: ModuleReader): ModuleReader {
  return { list: (dir) => reader.list(dir).sort().reverse(), read: (path) => reader.read(path) }
}

describe('buildBundle', () => {
  test('the working tree and a git ref give identical bytes', () => {
    const { fx, family } = sources()
    const fromFs = buildBundle(family, { reader: fsReader(fx.root) })
    const fromGit = buildBundle(family, { reader: gitReader(fx.root, 'HEAD') })
    expect(fromFs).not.toBeNull()
    expect(fromGit).toBe(fromFs)
    const bundle = JSON.parse(fromFs as string)
    expect(Object.keys(bundle.$defs).sort()).toEqual(['ComponentWorkload', 'Name', 'Port'])
    expect(bundle.$id).toBe('https://specifications.musher.dev/component/v1/component.schema.json')
  })

  test('the order a reader lists modules in does not change a byte', () => {
    const { fx, family } = sources()
    const forward = buildBundle(family, { reader: fsReader(fx.root) })
    expect(buildBundle(family, { reader: reversed(fsReader(fx.root)) })).toBe(forward)
    expect(buildBundle(family, { reader: reversed(gitReader(fx.root, 'HEAD')) })).toBe(forward)
  })

  test('a ref reads that ref, not the working tree', () => {
    const { fx, family } = sources()
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'later' }))
    expect(buildBundle(family, { reader: gitReader(fx.root, 'HEAD') })).not.toContain('later')
    expect(buildBundle(family)).toContain('later')
  })

  test('nothing authored is null; a module set without its root throws', () => {
    const fx = new FixtureRepo()
    repo = fx
    const family = { name: 'component', major: 'v1', repoRoot: fx.root }
    expect(buildBundle(family)).toBeNull()
    expect(buildBundle(family, { reader: gitReader(fx.root, 'HEAD') })).toBeNull()
    fx.writeFile(`${COMPONENT.src}/other.schema.json`, '{}\n')
    expect(() => buildBundle(family)).toThrow(/missing .*component\.schema\.json/)
  })
})

describe('pinnedBundle', () => {
  test('differs from the alias in $id and nothing else', () => {
    const { family } = sources()
    const alias = JSON.parse(buildBundle(family) as string)
    const pinned = JSON.parse(pinnedBundle(family, '1.2.0') as string)
    expect(pinned.$id).toBe(
      'https://specifications.musher.dev/component/v1.2.0/component.schema.json',
    )
    expect({ ...pinned, $id: alias.$id }).toEqual(alias)
    // Same key order too: only the one line differs.
    const aliasLines = (buildBundle(family) as string).split('\n')
    const pinnedLines = (pinnedBundle(family, '1.2.0') as string).split('\n')
    expect(pinnedLines.filter((line, i) => line !== aliasLines[i])).toHaveLength(1)
  })
})

describe('familyBundle and ensureBundleFile', () => {
  test('an edit between two calls is seen, not served from the memo', () => {
    const { fx, family } = sources()
    const before = familyBundle(family)
    expect(familyBundle(family)).toBe(before)
    fx.writeSources('component', 'v1', fx.bundleDoc('component', 'v1', { description: 'edited' }))
    expect(familyBundle(family)).toContain('edited')
  })

  test('writes the bundle under dist/ and returns its path', () => {
    const { fx, family } = sources()
    const path = ensureBundleFile(family)
    expect(path).toBe(join(fx.root, ...COMPONENT.bundle.split('/')))
    expect(readFileSync(path as string, 'utf8')).toBe(familyBundle(family) as string)
  })
})

describe('the command line', () => {
  test('--stdout prints the same bytes the library builds, pinned with --version', () => {
    const [family] = discoverKinds()
    if (family === undefined) throw new Error('no kind family in this repository')
    const cli = join(REPO_ROOT, 'tools', 'src', 'schema', 'bundle.ts')
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [cli, ...args], { cwd: REPO_ROOT, encoding: 'utf8' })

    const alias = run('--stdout', `${family.name}/${family.major}`)
    expect(alias.status).toBe(0)
    expect(alias.stdout).toBe(buildBundle(family) as string)

    const version = `${family.major.slice(1)}.4.2`
    const pinned = run('--stdout', `${family.name}/${family.major}`, '--version', version)
    expect(pinned.stdout).toBe(pinnedBundle(family, version) as string)

    expect(run('--stdout', `${family.name}/${family.major}`, '--version', '99.0.0').status).toBe(2)
  })
})

describe('the downstream contract', () => {
  /** Relative and bare module specifiers in a file's static imports and re-exports. */
  const SPECIFIER = /^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm

  test('bundle.ts reaches nothing but node: builtins, so it runs without bun install', () => {
    const start = [join(REPO_ROOT, 'tools', 'src', 'schema', 'bundle.ts')]
    const seen = new Set<string>()
    const external: string[] = []
    while (start.length > 0) {
      const file = start.pop() as string
      if (seen.has(file)) continue
      seen.add(file)
      for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        const specifier = match[1] as string
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier)
          expect(existsSync(target)).toBe(true)
          start.push(target)
        } else if (!specifier.startsWith('node:')) {
          external.push(`${file.slice(REPO_ROOT.length + 1)} imports ${specifier}`)
        }
      }
    }
    // A scan that followed nothing would pass for the wrong reason.
    for (const module of ['sources.ts', 'layout.ts', 'git.ts']) {
      expect([...seen].some((file) => file.endsWith(module))).toBe(true)
    }
    expect(external).toEqual([])
  })
})
