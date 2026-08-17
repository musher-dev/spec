# Contributing

Thank you for helping shape the Musher specification. This repository defines a
public contract, so the bar for changes is deliberately higher than for an
ordinary codebase.

## Ground rules

1. **The prose is normative; the schema and the corpus are its executable
   forms.** `spec.md` defines the complete behaviour of a family. The JSON
   Schema bundle is its executable form for structural validity and the
   conformance corpus is its executable form for observable outcomes — both
   normative, and neither permitted to disagree with the prose or with the
   other. Schema `description` fields, examples, and validator message text are
   informative. A disagreement between two normative artifacts is a defect that
   blocks a release, not something an implementation gets to resolve.

   Implementations are downstream of all three. A change here obligates the CLI,
   the API, and every SDK. Propose accordingly.
2. **No schema change without conformance fixtures.** Every behavioural change
   must arrive with at least one positive and one negative fixture that would
   fail before the change and pass after it.
3. **Never hand-edit `schemas/dist/`.** It is generated. Edit
   `schemas/src/*.schema.json` and run `task bundle`.
4. **Validation never becomes stricter within a major version.** If your change
   makes a previously valid document invalid, it is a major release and needs a
   new `v<N>` directory.

## Development environment

The supported environment is the dev container:

**Command Palette → Dev Containers: Reopen in Container**

Outside the container you need [Bun](https://bun.sh) ≥ 1.3 and
[Task](https://taskfile.dev) ≥ 3.5.

```sh
task setup     # install tool dependencies and git hooks
task check     # run everything CI runs
```

## Making a change

```sh
# 1. Edit the authored modules
$EDITOR specifications/component/v1/schemas/src/component.schema.json

# 2. Regenerate the published bundle
task bundle

# 3. Add fixtures proving the new behaviour
mkdir -p conformance/component/v1/structural/010-my-new-rule

# 4. Verify
task check
```

A fixture is a `case.yaml` when the rule is decided by reading one document,
and a `tree/` when it is decided by reading the item the document sits in —
a slug against its directory, a reference against a file. See
[conformance/README.md](conformance/README.md#case-trees).

Adding a diagnostic code or a requirement ID to a `spec.md` obliges you to add a
case for it.
`check:conformance` fails otherwise, and the only way out is an entry in the
runner's `UNCOVERED` list saying why the code cannot be exercised.

`task check` runs, in order:

| Step | What it enforces |
|---|---|
| `check:format` | Biome formatting and lint of `tools/` |
| `check:types` | TypeScript typecheck of `tools/` |
| `check:schema` | Every `src/` module is valid JSON Schema 2020-12; `$id`s are unique and canonical; no remote `$ref` |
| `check:drift` | The committed `dist/` bundle matches a fresh compile of `src/` |
| `check:examples` | Every file in `examples/` validates against its family's bundle |
| `check:conformance` | Every conformance case produces its declared outcome; every declared diagnostic code and requirement ID has a case; every case directory is indexed |
| `check:standards` | An independent JSON Schema toolchain accepts every module and bundle |
| `check:parity` | Ajv and Blaze agree on every structural verdict |
| `check:published` | Every released version still hashes to what `published.json` recorded |
| `check:compat` | No released version's accepted documents are rejected by the candidate schema |
| `check:test` | The tooling test suite, including the publication-immutability regressions |
| `check:commits` | The Conventional Commits vocabulary agrees across its three copies |
| `check:links` | Every internal Markdown link and anchor resolves |
| `check:spelling` | Prose, tooling, and schema descriptions spell-check clean |
| `check:shell` | ShellCheck over `.devcontainer/scripts` |
| `check:workflow` | actionlint over `.github/workflows` |

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commit-msg` git hook locally and on the PR title in CI.

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `perf`, `docs`, `chore`, `refactor`, `test`, `ci`,
`build`, `style`, `revert`.

Scopes: `component`, `blueprint`, `listing`, `conformance`, `tools`, `ci`,
`devcontainer`, `docs`, `repo`, `deps`.

Releases are cut by [release-please](https://github.com/googleapis/release-please)
from these messages. A `feat(component):` commit produces a `component/v1.x.0`
tag; `feat(blueprint):` produces `blueprint/v1.x.0`. Families release
independently, so scope your commits accurately — an unscoped `feat:` will not
release anything.

## Sign your work

This project uses the [Developer Certificate of Origin](https://developercertificate.org/).
Every commit must carry a `Signed-off-by` trailer:

```sh
git commit -s -m "feat(component): add restartPolicy"
```

## Proposing a structural change

Changes to the repository architecture, the release model, or the family
taxonomy need an ADR in [`docs/adr/`](docs/adr/). Copy the format of
[ADR 0001](docs/adr/0001-canonical-repository-architecture.md), open it as a PR
on its own, and get it accepted before writing the implementation.

## Reporting a problem in the specification

Open an issue describing the document you were authoring, what you expected to
validate, and what actually happened. A failing conformance fixture is the most
useful possible bug report.
