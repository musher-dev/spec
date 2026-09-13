/**
 * The layout module is the only place a repository path is spelled.
 *
 * The guard below is what keeps it that way. A path written out in a tool is
 * a path the next layout change misses, and a missed path at a released tag
 * reads as nothing rather than failing.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { FixtureRepo } from '../testing/fixture.ts'
import {
  conformanceLink,
  discoverFamilies,
  familyPaths,
  LayoutError,
  parseManifestKey,
  parseSpecPath,
  REPO_ROOT,
  requireAtRef,
  requireFileAtRef,
  requireTreeAtRef,
} from './layout.ts'

const SOURCE_ROOT = join(REPO_ROOT, 'tools', 'src')

/** Files allowed to spell a repository path: this module, its test, and fixtures. */
const EXEMPT_FILES = new Set(['lib/layout.ts', 'lib/layout.test.ts'])
const EXEMPT_DIRS = ['testing/']

/** A quoted string that begins with a top-level repository directory. */
const PATH_LITERAL = /['"`](specifications|conformance)\//
/** A path assembled from segments instead: `join(dir, 'schemas', 'dist')`. */
const PATH_SEGMENTS = /['"`]schemas['"`]\s*,\s*['"`](dist|src)['"`]/

function typescriptFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...typescriptFiles(path))
    else if (entry.endsWith('.ts')) found.push(path)
  }
  return found
}

/** Every line outside a comment that spells a repository path, as `file:line: text`. */
function pathLiterals(): { scanned: number; offenders: string[] } {
  const offenders: string[] = []
  let scanned = 0
  for (const file of typescriptFiles(SOURCE_ROOT)) {
    const rel = relative(SOURCE_ROOT, file).split(sep).join('/')
    if (EXEMPT_FILES.has(rel) || EXEMPT_DIRS.some((dir) => rel.startsWith(dir))) continue
    scanned += 1
    for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      const code = line.trimStart()
      // Prose may name a path; only code is read by a tool.
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) continue
      if (PATH_LITERAL.test(line) || PATH_SEGMENTS.test(line)) {
        offenders.push(`${rel}:${index + 1}: ${code}`)
      }
    }
  }
  return { scanned, offenders }
}

let repo: FixtureRepo | null = null
let scratch: string | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true })
  scratch = null
})

describe('the layout guard', () => {
  test('no tool spells a repository path outside the layout module', () => {
    const { scanned, offenders } = pathLiterals()
    // A guard that found no files would pass for the wrong reason.
    expect(scanned).toBeGreaterThan(20)
    expect(offenders).toEqual([])
  })
})

describe('familyPaths', () => {
  test('names every part of a family version, repo-relative', () => {
    expect(familyPaths('component', 'v1')).toEqual({
      dir: 'specifications/component/v1',
      spec: 'specifications/component/v1/spec.md',
      src: 'specifications/component/v1/schemas/src',
      dist: 'specifications/component/v1/schemas/dist',
      bundle: 'specifications/component/v1/schemas/dist/component.schema.json',
      examples: 'specifications/component/v1/examples',
      conformance: 'conformance/component/v1',
      manifestKey: 'specifications/component/v1',
    })
  })

  test('the manifest key and the prose path parse back to the family version', () => {
    const paths = familyPaths('listing', 'v2')
    expect(parseManifestKey(paths.manifestKey)).toEqual({ name: 'listing', major: 'v2' })
    expect(parseSpecPath(paths.spec)).toEqual({ name: 'listing', major: 'v2' })
    expect(parseManifestKey('tools')).toBeNull()
    expect(parseSpecPath('specifications/listing/v2/README.md')).toBeNull()
  })

  test('a conformance link is relative to the page that carries it', () => {
    expect(conformanceLink('docs', 'component', 'v1', 'parser/parser-001-x')).toBe(
      '../conformance/component/v1/parser/parser-001-x/',
    )
  })
})

describe('discoverFamilies', () => {
  test('finds nothing, without failing, where nothing is authored', () => {
    scratch = mkdtempSync(join(tmpdir(), 'musher-layout-'))
    expect(discoverFamilies(scratch)).toEqual([])
  })

  test('throws when specifications/ has children but no family version', () => {
    scratch = mkdtempSync(join(tmpdir(), 'musher-layout-'))
    mkdirSync(join(scratch, 'specifications', 'component'), { recursive: true })
    expect(() => discoverFamilies(scratch as string)).toThrow(LayoutError)
  })
})

describe('requireAtRef', () => {
  function tagged(): FixtureRepo {
    repo = new FixtureRepo()
    repo.writeFamilySkeleton('component', 'v1')
    repo.commit('feat(component): a family version')
    repo.tag('component/v1.0.0')
    return repo
  }

  test('reads a file and lists a directory at the ref', () => {
    const fx = tagged()
    const paths = familyPaths('component', 'v1')
    expect(
      requireFileAtRef(fx.root, 'component/v1.0.0', paths.spec, 'prose').length,
    ).toBeGreaterThan(0)
    expect(requireTreeAtRef(fx.root, 'component/v1.0.0', paths.examples, 'examples')).toEqual([
      `${paths.examples}/minimal.yaml`,
    ])
  })

  test('throws a LayoutError naming the ref and the path when the ref lacks it', () => {
    const fx = tagged()
    const missing = 'specifications/component/v1/moved'
    expect(() => requireAtRef(fx.root, 'component/v1.0.0', missing, 'corpus')).toThrow(LayoutError)
    expect(() => requireAtRef(fx.root, 'component/v1.0.0', missing, 'corpus')).toThrow(
      /component\/v1\.0\.0.*specifications\/component\/v1\/moved/,
    )
  })

  test('throws when a file is found where a directory was expected, and the reverse', () => {
    const fx = tagged()
    const paths = familyPaths('component', 'v1')
    expect(() => requireTreeAtRef(fx.root, 'component/v1.0.0', paths.spec, 'x')).toThrow(
      LayoutError,
    )
    expect(() => requireFileAtRef(fx.root, 'component/v1.0.0', paths.examples, 'x')).toThrow(
      LayoutError,
    )
  })
})
