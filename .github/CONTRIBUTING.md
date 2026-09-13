# Contributing

Thank you for helping shape the Musher document specifications. This repository
defines a public contract, so the bar for changes is deliberately higher than
for an ordinary codebase.

## Where to start

The [README](../README.md) routes you by task under "I want to…": use a schema,
implement a validator, change a specification, or understand a decision. To
change a specification, read what a family version holds in
[specifications/README.md](../specifications/README.md#anatomy), then continue
below.

## Ground rules

1. **The prose is normative.** `spec.md` defines a family's complete behaviour.
   The schema bundle and the conformance corpus are its executable forms, and
   none of the three may disagree with another. See
   [What is normative](../specifications/README.md#what-is-normative). A change
   here obligates the CLI, the API and every SDK, so propose accordingly.
2. **No behavioural change without conformance cases.** Add a positive and a
   negative case that fail before the change and pass after it. See
   [conformance/README.md](../conformance/README.md).
3. **Edit sources, never build output.** Bundles and the catalog are built, and
   nothing under `dist/` is committed.
4. **Validation never becomes stricter within a major version.** The rule, and
   the one pre-publication exception, are in
   [GOVERNANCE.md → Compatibility review](../GOVERNANCE.md#compatibility-review).
5. **Shared rules live in core.** A family cites the
   [core specification](../specifications/core/v1/spec.md). It does not restate
   core's rules.

## Development environment

The supported environment is the dev container:

**Command Palette → Dev Containers: Reopen in Container**

Outside the container you need [Bun](https://bun.sh) ≥ 1.3 and
[Task](https://taskfile.dev) ≥ 3.5.

```sh
task setup     # install tool dependencies and git hooks
task check     # run everything CI runs
```

The tasks live in [`taskfiles/`](../taskfiles/), included by the root
`Taskfile.yml`. Every linter, formatter and hook config lives in
[`.config/`](../.config/README.md), and every caller names its config with the
tool's own flag. Adding one has a fixed shape, which that page describes.

## Making a change

```sh
# 1. Edit the authored modules
$EDITOR specifications/component/v1/schemas/src/component.schema.json

# 2. Optional: build the bundle into dist/ to read it. Every check builds it in memory.
task bundle

# 3. Add cases proving the new behaviour, in that family version's corpus
mkdir -p specifications/component/v1/conformance/structural/010-my-new-rule

# 4. Verify
task check
```

`task changes` reports what your branch does to the contract. It lists fields
added and removed, required fields, enum members, patterns, bounds, defaults,
diagnostics and requirement IDs, and says which of those can reject a document
that validates today. It only reports; `check:compat` is the gate. CI runs it on
every pull request and writes it to the job summary.

A case is a `case.yaml` when the rule is decided by reading one document. It is a
`tree/` when the rule is decided by reading the item the document sits in, such
as a slug checked against its directory or a reference checked against a file.
See [conformance/README.md](../conformance/README.md#case-trees).

A case lives inside the family version it tests, at
`specifications/<family>/v<N>/conformance/`. A commit that adds or corrects a
case therefore enters that family's release, like a change to its prose or
schema (see [Commit messages](#commit-messages)).

Adding a diagnostic code or a requirement ID to a `spec.md` obliges you to add a
case for it. `check:conformance` fails otherwise. The only way out is an entry
in the runner's exclusion list saying why the code or ID cannot be exercised.

### How your pull request merges

There is no blanket review requirement. A pull request that touches no path
listed in [`.github/CODEOWNERS`](CODEOWNERS) merges once the required checks are
green: `Lint`, `Schema`, `Site Build` and `Signed off`. Today that list holds
only the review gate's own two configuration files. Nobody has to approve such a
pull request.

That is a deliberate trade, not an oversight. It puts the weight on the checks,
which is where it belongs for a repository whose contract can be verified by
machine. [ADR 0015](../docs/adr/0015-selective-code-owner-review.md) explains
it, and GOVERNANCE.md still asks for a maintainer's eyes on a change of
consequence even where nothing blocks the merge.

`task check` runs every step CI runs. What each step enforces, and the script
behind it, are listed in [tools/README.md → Checks](../tools/README.md#checks).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commit-msg` git hook locally and on the PR title in CI.

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `perf`, `docs`, `chore`, `refactor`, `test`, `ci`,
`build`, `style`, `revert`.

Scopes: `core`, `component`, `blueprint`, `listing`, `conformance`, `tools`,
`ci`, `devcontainer`, `docs`, `repo`, `deps`, `deps-dev`.

`deps` and `deps-dev` are Dependabot's: a dependency update arrives as
`build(deps):`, `build(deps-dev):`, or `ci(deps):`. See
[ADR 0016](../docs/adr/0016-dependency-update-policy.md).

`task check:commits` holds these two lists in step with their other copies:
`.github/conventional-commits.yaml`, `.github/workflows/lint-pr.yml`,
`.config/lefthook.yml` and `.github/dependabot.yml`.

### How a commit reaches a release

[release-please](https://github.com/googleapis/release-please) keeps four
packages, one per family version: `specifications/core/v1`,
`specifications/component/v1`, `specifications/blueprint/v1` and
`specifications/listing/v1`. It assigns a commit to a package by the **paths the
commit changes**, not by its scope. The scope only labels the area for a reader.
A family version's conformance corpus sits inside its package, so a case change
releases the family just as a prose or schema change does.

Pick the type by what the change does to a package:

| Change under `specifications/<family>/v<N>/` | Type | Releases |
|---|---|---|
| Adds a field, a rule, or a case pinning a new rule | `feat` | Yes |
| Corrects a rule, a schema, or a case that was wrong | `fix` | Yes |
| Changes prose without changing a rule | `docs` | Yes |
| Changes nothing a release asserts | `refactor`, `chore`, `test`, `ci`, `build`, `style`, `perf` | No |

A commit touching two families enters both releases. A breaking change carries
`!` or a `BREAKING CHANGE:` footer, whatever its type.

Use the `core` scope for a change to `specifications/core/`. A releasable
commit there holds every kind family's release until core has released it. See
[docs/publication.md → The core gate](../docs/publication.md#the-core-gate).

### Squash merges and overrides

`main` accepts squash merges only, and titles the merge commit with the pull
request title. release-please therefore reads one commit per pull request.
Where a pull request carries more than one type of change, such as a `feat` for
one family and a `refactor` elsewhere, end its body with an override that lists
each change:

```
BEGIN_COMMIT_OVERRIDE
feat(component): add restartPolicy
refactor(tools): read the layout from one module
END_COMMIT_OVERRIDE
```

**After core's first release, a pull request touching `specifications/core/`
must not use an override.** The core gate classifies core commits from
`git log`, which holds the squash commit and not the pull request body. An
override there would let release-please and the gate disagree about whether core
has a releasable change. Split the pull request, or give it a title whose type is
right for the core change. This is a review obligation, and no check enforces it.

## Sign your work

This project uses the [Developer Certificate of Origin](https://developercertificate.org/).
Every commit must carry a `Signed-off-by` trailer:

```sh
git commit -s -m "feat(component): add restartPolicy"
```

The trailer's name and email must match the commit's author. There is one
exception, for a GitHub App. An app signs under its operator's address rather
than the noreply address its commits are authored from, so a bot's sign-off is
matched on name alone. See
[ADR 0016](../docs/adr/0016-dependency-update-policy.md).

## Proposing a structural change

Changes to the repository architecture, the release model, core, or the family
taxonomy need an ADR. [GOVERNANCE.md](../GOVERNANCE.md#decision-process) lists
what counts as structural. [docs/adr/README.md](../docs/adr/README.md) covers
the format and how to add an ADR. Open the ADR as a pull request on its own,
and get it accepted before writing the implementation.

## Reporting a problem in the specification

Open an issue describing the document you were authoring, what you expected to
validate, and what actually happened. A failing conformance case is the most
useful possible bug report.
