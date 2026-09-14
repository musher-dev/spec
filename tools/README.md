# Tools

The scripts that build and check this repository's artifacts. **Nothing here is
normative.** The contract is each family's `spec.md`, its schema sources and its
conformance corpus. These scripts are one non-normative reading of them, and
where a script and the prose disagree, the script has a defect.

The runtime is [Bun](https://bun.sh), at the version
[`tools/.bun-version`](.bun-version) names. CI installs that version from the file, and a release job installs the
version its tag's copy names. Bun runs the TypeScript directly, so there is no
build step. Dependencies are pinned by `bun.lock`, and `task setup` installs
them.

Every task in [`taskfiles/`](../taskfiles/) runs from this directory as
`bun run src/<group>/<script>.ts`, so a script can also be run by hand from
`tools/` with the same command.

## Groups

- **`lib/`**: shared helpers. `layout.ts` spells every repository path, `git.ts`
  reads refs, `outline.ts` indexes a `spec.md`'s sections and requirement IDs,
  and `bindings.ts` reads the parameters a kind family binds to core.
- **`schema/`**: the bundler (`bundle.ts`, `sources.ts`), the schema policy
  lint (`lint.ts`), and the independent meta-validation (`standards.ts`).
- **`validation/`**: the parser, structural and semantic phases this repository
  runs over documents, and the effective-value resolver.
- **`conformance/`**: the conformance runner, example validation, and the
  Ajv-against-Blaze parity check.
- **`publication/`**: the ledger, recording and staging a release, verifying
  releases offline and against GitHub, the core gate, the compatibility replay,
  the change report, the catalog, and the site assembler.
- **`render/`**: generated pages and documents: the traceability matrix, the
  ADR index, the prose and field reference, and the post-deploy live check.
- **`policy/`**: repository rules: `.config/` layout, the review gate, commit
  vocabulary, tracked build output, generated-document freshness, links, and
  ADRs.
- **`testing/`**: test support only. No task runs anything here.

## <a id="checks"></a>Checks

`task check` runs these steps in this order. CI runs the same steps across its
jobs: **Lint** runs `task ci:lint` and `check:types`, **Schema** runs
`task ci:test`, and **Site Build** runs `check:published`, then the CI-only
steps listed [below](#ci-only). Every step must pass before a pull request
merges.

| Task | What it enforces | Script | Rule IDs |
|---|---|---|---|
| `check:format` | Biome formatting and lint of `tools/` | `biome ci .` | — |
| `check:config` | The `.config/` layout: every file indexed, reachable, and passed by path | `src/policy/config.ts` | CFG-01..CFG-08 |
| `check:rulesets` | The two halves of the review gate agree, and no required status check can hang a pull request | `src/policy/rulesets.ts` | RUL-01..RUL-09 |
| `check:types` | TypeScript typecheck of `tools/` | `tsc --noEmit` | — |
| `check:schema` | Every source module is valid JSON Schema 2020-12, `$id`s are unique and canonical, no `$ref` is remote, and repository naming holds | `src/schema/lint.ts` | — |
| `check:generated` | No build output is tracked: nothing under `dist/`, no `schemas/dist/`, no root `catalog.json` | `src/policy/generated.ts` | — |
| `check:examples` | Every example validates against its family's bundle | `src/conformance/examples.ts` | — |
| `check:conformance` | Every case produces its declared outcome, and every declared diagnostic code and requirement ID has a case or a written exclusion | `src/conformance/conformance.ts` | — |
| `check:standards` | An independent JSON Schema toolchain accepts every module and bundle | `src/schema/standards.ts` | — |
| `check:parity` | Ajv and Blaze agree on every structural verdict | `src/conformance/parity.ts` | — |
| `check:published` | Every ledger entry matches git: a tagged entry its tag's tree and ledger, a pending entry `HEAD` and a fresh build | `src/publication/verify.ts` | — |
| `check:editions` | Where core stands, and the core gate on every pending kind family release | `src/publication/core-gate.ts` | — |
| `check:compat` | No released version's accepted documents are rejected by the candidate schema | `src/publication/compat.ts` | — |
| `check:test` | The tooling test suite | `bun test` | — |
| `check:commits` | The Conventional Commits vocabulary agrees across all five of its copies | `src/policy/commits.ts` | — |
| `check:docs` | `docs/traceability.md` and the ADR index match a fresh generation | `src/policy/docs.ts` | — |
| `check:links` | Every internal Markdown link and anchor resolves | `src/policy/links.ts` | — |
| `check:adr` | ADR numbering, headers and relations, and link-target-only edits to accepted ADRs | `src/policy/adr.ts` | ADR-01..ADR-04 |
| `check:md` | markdownlint over every Markdown file | `markdownlint-cli2` | — |
| `check:spelling` | Prose, tooling sources and schema descriptions spell-check clean | `cspell` | — |
| `check:shell` | ShellCheck over the dev container scripts | `shellcheck` | — |
| `check:workflow` | actionlint over `.github/workflows` | `actionlint` | — |

A step named by a tool rather than a script reads its configuration from
[`.config/`](../.config/README.md), or from `biome.json` and `tsconfig.json` here.

### <a id="ci-only"></a>Runs only in CI

These need a pull request, the network or a GitHub token, so `task check` does
not run them. Everything else CI runs, `task check` runs locally.

| Step | Job | When | Script |
|---|---|---|---|
| DCO sign-off on every commit | `Signed off` | Pull requests | `.github/workflows/dco.yml` |
| `check:title`: the pull request title is a Conventional Commit, with a type and scope from `.github/conventional-commits.yaml` | `Lint` | Pull requests | `src/policy/title.ts` |
| `check:ledger`: `published.json` edits no entry the base branch holds | `Site Build` | Pull requests | `src/publication/ledger.ts check` |
| `site:fetch`, then `site:build` | `Site Build` | Every run | `src/publication/fetch.ts`, `src/publication/site.ts` |

`lint-pr.yml` still runs on pull requests, to lowercase a Dependabot title, but
the title is enforced by `check:title`.

## Build, release and site tasks

These are not part of `task check`. Each takes the variables (`NAME=value` on
the command line) and environment variables shown.

| Task | What it does | Script | Takes |
|---|---|---|---|
| `bundle` | Builds every bundle and the catalog into `dist/`, then runs `docs` | `src/schema/bundle.ts` | — |
| `docs` | Regenerates `docs/traceability.md` and the ADR index | `src/render/traceability.ts`, `src/render/adr-index.ts` | — |
| `catalog` | Regenerates `dist/catalog.json` | `src/publication/catalog.ts` | — |
| `changes` | Reports what the branch does to the published contract | `src/publication/changes.ts` | `BASE` variable, default `origin/main`; `-- --diff` |
| `check:title` | Fails unless the pull request title is a Conventional Commit using the vocabulary in `.github/conventional-commits.yaml` | `src/policy/title.ts` | `PR_TITLE` environment variable, required |
| `check:ledger` | Fails if `published.json` changed a recorded entry | `src/publication/ledger.ts check` | `BASE_REF` environment variable; without it, only parses |
| `check:published:online` | Verifies every tagged release's GitHub release and assets, without caching | `src/publication/fetch.ts --verify-only` | `GITHUB_TOKEN`, else `gh auth token`; `GITHUB_REPOSITORY` |
| `release:record` | Records every pending release in `published.json`, applying the core gate | `src/publication/record.ts` | — |
| `release:stage` | Verifies a tagged release and stages its assets into `dist/release/` | `src/publication/stage.ts` | `TAG` variable, required; `SOURCE_DATE_EPOCH`, default `0`; `BASE_LEDGER_REF`, default `origin/main` |
| `site:fetch` | Verifies every tagged release on GitHub and caches its bundle in `.cache/releases/` | `src/publication/fetch.ts` | `GITHUB_TOKEN`, else `gh auth token`; `GITHUB_REPOSITORY`; `ALLOW_PENDING_RELEASES=1` turns an unpublished tagged release into a warning and records it in `.cache/releases/pending.json` |
| `site:build` | Runs `site:fetch` when the ledger has a tagged entry, then assembles `site/`, leaving out releases `pending.json` lists | `src/publication/site.ts` | As `site:fetch`, including `GITHUB_TOKEN` and `ALLOW_PENDING_RELEASES` |
| `site:deploy` | Uploads `site/` to Cloudflare Pages | `wrangler pages deploy` | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, both required; `PAGES_PROJECT` variable |
| `site:verify-live` | Fetches every pinned URL and alias from the origin and compares hashes | `src/render/verify-live.ts` | `ORIGIN` variable, else `SITE_ORIGIN`, else the production host |

`check:adr` also reads `BASE_REF`, falling back to `origin/main`. How these
tasks fit together in a release is in [Publication](../docs/publication.md).

## Layout module

`src/lib/layout.ts` is the only place a repository path is spelled. Every other
script asks it where a family's prose, schema sources, examples and corpus live.
A guard test in `src/lib/layout.test.ts` fails the suite when any other module
outside `testing/` quotes a string beginning `specifications/` or
`conformance/`, or assembles one from `'schemas', 'dist'` segments.

The layout distinguishes two roles of family, as
[specifications/README.md](../specifications/README.md#kind-family) defines
them. **Core** is the base family: it
defines no `kind`, carries prose and a parser-phase corpus, and has no schema and
no examples. Every other family is a **kind** family, which binds core's
parameters and publishes a bundle. `discoverFamilies` lists core first, and
`discoverKinds` lists only kind families. A tool reading a released ref asks
through `requireAtRef` and its variants, which throw a `LayoutError` when a path
the layout names is absent, rather than returning nothing and passing.

## Bundler CLI

The bundler's command line is a downstream contract:

```sh
bun tools/src/schema/bundle.ts --stdout <family>/<major> [--version X.Y.Z]
```

This is how to get a bundle before a family's first release, when no exact
release URL exists yet: pin a commit of this repository and run it there.

It prints one bundle: the major-version alias, or with `--version` the pinned
bundle carrying that release's `$id`. With no arguments it writes every bundle
and the catalog into `dist/`. Downstream repositories run it at a pinned commit
of this repository **without `bun install`**, so `bundle.ts`, `sources.ts` and
everything they import use `node:` built-ins only. `src/schema/bundle.test.ts`
scans the import graph to hold that, and `task changes` relies on the same
contract to build a base commit's bundle with that commit's own bundler.

## Tests

Tests sit beside the module they test, as `<module>.test.ts`, and `bun test`
from `tools/` runs them all (`task check:test`). Nothing in a test touches this
repository's own history. The support modules in `src/testing/` provide what the
tests need instead:

- **`fixture.ts`**: `FixtureRepo`, a throwaway git repository with helpers to
  write families, sources, ledgers and release configuration, and to commit,
  branch and tag. Git configuration is neutralised, so a developer's global
  config cannot change a result.
- **`pipeline.ts`**: `Pipeline`, the release flow run locally against a
  `FixtureRepo`: record, tag, stage, publish and fetch, in the order CI runs
  them.
- **`release-source.ts`**: `FakeReleaseSource`, an in-memory stand-in for GitHub
  releases, with a toggle for every property `fetch.ts` refuses on.
