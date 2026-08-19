/**
 * Each `.config/` layout rule, exercised against a throwaway tree.
 *
 * A gate that cannot fail is indistinguishable from no gate, and the two rules
 * worth having here — CFG-04 and CFG-06 — both guard against failures that are
 * silent by nature. So every code gets a case that provokes it, and a clean
 * tree gets one that proves it stays quiet.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { configViolations } from './config.ts'
import { FixtureRepo } from './testing/fixture.ts'

let repo: FixtureRepo | null = null

afterEach(() => {
  repo?.cleanup()
  repo = null
})

const INDEX = [
  '# `.config/` — Tool Configuration',
  '',
  '| File | Tool | How it is reached |',
  '| --- | --- | --- |',
  '| `lefthook.yml` | lefthook | Auto-discovered |',
  '| `spelling/cspell.json` | cspell | `--config .config/spelling/cspell.json` |',
].join('\n')

/** A tree that satisfies every rule, as the starting point for each case. */
function intact(): FixtureRepo {
  repo = new FixtureRepo()
  repo.writeFile('.config/README.md', INDEX)
  repo.writeFile('.config/lefthook.yml', 'pre-commit:\n  jobs: []\n')
  repo.writeFile('.config/spelling/cspell.json', '{ "version": "0.2" }\n')
  repo.writeFile('Taskfile.yml', 'version: "3"\n# cspell --config .config/spelling/cspell.json\n')
  return repo
}

/** The codes reported, so a case asserts on the rule rather than the prose. */
function codes(root: string): string[] {
  return configViolations(root).map((problem) => problem.slice(0, 6))
}

describe('an intact tree', () => {
  test('reports nothing', () => {
    expect(configViolations(intact().root)).toEqual([])
  })
})

describe('CFG-01/02 — the directory and its index', () => {
  test('CFG-01 fires when .config/ is absent, and reports nothing else', () => {
    repo = new FixtureRepo()
    repo.writeFile('Taskfile.yml', 'version: "3"\n')
    // The remaining rules all describe the contents of a directory that is not
    // there, so reporting them too would bury the one finding that matters.
    expect(codes(repo.root)).toEqual(['CFG-01'])
  })

  test('CFG-02 fires when the index is missing', () => {
    const fx = intact()
    fx.remove('.config/README.md')
    expect(codes(fx.root)).toContain('CFG-02')
  })

  test('a missing index does not also report every file as unindexed', () => {
    const fx = intact()
    fx.remove('.config/README.md')
    expect(codes(fx.root)).not.toContain('CFG-03')
  })
})

describe('CFG-03/04 — indexed, and reachable', () => {
  test('CFG-03 fires for a file with no index row', () => {
    const fx = intact()
    fx.writeFile('.config/yaml/yamllint.yaml', 'extends: default\n')
    fx.writeFile('Taskfile.yml', 'version: "3"\n# yamllint -c .config/yaml/yamllint.yaml\n')
    expect(codes(fx.root)).toEqual(['CFG-03'])
  })

  test('CFG-04 fires for a config no caller names', () => {
    const fx = intact()
    fx.writeFile('.config/yaml/yamllint.yaml', 'extends: default\n')
    fx.writeFile('.config/README.md', `${INDEX}\n| \`yaml/yamllint.yaml\` | yamllint | \`-c\` |`)
    expect(codes(fx.root)).toEqual(['CFG-04'])
  })

  test('lefthook is exempt from CFG-04, being auto-discovered', () => {
    // Nothing names .config/lefthook.yml by path anywhere, by design.
    expect(configViolations(intact().root)).toEqual([])
  })

  test('a bucket sibling counts as a caller', () => {
    // cspell reaches its dictionary through a path relative to the config's own
    // directory, so the reference reads `./musher.txt` and never the repo path.
    const fx = intact()
    fx.writeFile('.config/spelling/musher.txt', 'blueprint\n')
    fx.writeFile(
      '.config/spelling/cspell.json',
      '{ "dictionaryDefinitions": [{ "path": "./musher.txt" }] }\n',
    )
    fx.writeFile('.config/README.md', `${INDEX}\n| \`spelling/musher.txt\` | cspell | path |`)
    expect(configViolations(fx.root)).toEqual([])
  })

  test('a sibling in another bucket does not count', () => {
    const fx = intact()
    fx.writeFile('.config/yaml/musher.txt', 'blueprint\n')
    fx.writeFile('.config/README.md', `${INDEX}\n| \`yaml/musher.txt\` | cspell | path |`)
    expect(codes(fx.root)).toEqual(['CFG-04'])
  })
})

describe('CFG-05 — no leading dot', () => {
  test('fires on a dotted filename', () => {
    const fx = intact()
    fx.writeFile('.config/spelling/.cspell.json', '{}\n')
    expect(codes(fx.root)).toContain('CFG-05')
  })
})

describe('CFG-06 — the shadowing trap', () => {
  test.each(['lefthook.yml', 'lefthook.yaml', 'lefthook.toml', '.lefthook.yml', '.lefthook.json'])(
    'a root %s shadows the real config',
    (name) => {
      const fx = intact()
      fx.writeFile(name, 'pre-commit:\n  jobs: []\n')
      expect(codes(fx.root)).toContain('CFG-06')
    },
  )
})

describe('CFG-07 — placement', () => {
  test('fires on a config at the top level of .config/', () => {
    const fx = intact()
    fx.writeFile('.config/yamllint.yaml', 'extends: default\n')
    fx.writeFile('.config/README.md', `${INDEX}\n| \`yamllint.yaml\` | yamllint | \`-c\` |`)
    fx.writeFile('Taskfile.yml', 'version: "3"\n# yamllint -c .config/yamllint.yaml\n')
    expect(codes(fx.root)).toEqual(['CFG-07'])
  })

  test('fires on a stray tool config at the repo root', () => {
    const fx = intact()
    fx.writeFile('cspell.json', '{}\n')
    expect(codes(fx.root)).toEqual(['CFG-07'])
  })

  test('leaves root-only configs alone', () => {
    // Git, Task and EditorConfig have no config-path flag, so the root is the
    // only place they can be. Flagging them would make the gate impossible to pass.
    const fx = intact()
    for (const name of ['.gitignore', '.gitattributes', '.editorconfig']) {
      fx.writeFile(name, '\n')
    }
    expect(configViolations(fx.root)).toEqual([])
  })
})

describe('CFG-08 — configuration only', () => {
  test.each(['run.sh', 'check.py', 'build.ts'])('fires on %s', (name) => {
    const fx = intact()
    fx.writeFile(`.config/spelling/${name}`, '\n')
    expect(codes(fx.root)).toContain('CFG-08')
  })
})
