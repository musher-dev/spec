# ADR 0021: The repository is organized around the family version, under one name

- **Status:** Accepted
- **Date:** 2026-09-13
- **Supersedes:** [ADR 0001](0001-canonical-repository-architecture.md) §1, the repository's name only
- **Supersedes:** [ADR 0002](0002-conformance-case-trees.md) §1, only where the corpus lives
- **Refines:** [ADR 0012](0012-cloudflare-pages-publication.md) §1, the hostname it serves
- **Refines:** [ADR 0011](0011-tooling-configuration-layout.md), its note on how the root sorts
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

The repository has been renamed on GitHub from `musher-dev/spec` to
`musher-dev/specifications`, and nothing else followed. Every `$id` still names
`schemas.musher.dev`, a hostname that names only the schema, for a family version
that also publishes prose, examples and a conformance corpus, on a site that also
serves the reference built from `spec.md`
([ADR 0017](0017-generated-field-reference.md)).

The larger problem is that the unit a contributor edits is not the unit that gets
released. `.github/release-please/config.json` declares one package per family
version, keyed `specifications/<family>/v1`, and release-please assigns a commit
to a package by the **paths it changes**. The corpus sits outside every package
path, at `conformance/<family>/v1`, so a `fix` that corrects a fixture releases
nothing. Yet the fixture is normative, `release.yml` copies it into the release
archive, and `tools/src/publication/compat.ts` reads it back out of each tag to decide what
that release accepted. A normative change to a fixture produces no release. No
tag exists, so this has cost nothing yet. It would have on the first.

[ADR 0001](0001-canonical-repository-architecture.md) §7 describes the corpus
without placing it. The root `conformance/` tree was a bootstrap layout, which
[ADR 0002](0002-conformance-case-trees.md) §1 wrote down only as the path of an
example.

Moving the corpus exposes the third problem. The layout is spelled wherever a
tool needed it — in `compat.ts`, `site.ts`, `released.ts`, `spec.ts` and
`testing/fixture.ts`, and outside TypeScript in `release.yml` and
`.gitattributes` — and a wrong spelling does not fail. At a ref that lacks the
path, `readBlobAtRef` returns `null` and `listTreeFiles` returns `[]`. `site.ts`
then renders a reference page with no prose and no examples, and `compat.ts`
replays zero documents and reports that validation did not become stricter. Move
the corpus, miss one spelling in `compat.ts`, and the compatibility gate stays
green at every future tag while checking nothing.

Two governance rules also collide once anything moves.
[GOVERNANCE.md](../../GOVERNANCE.md#decision-process) says ADRs are "immutable
once accepted — supersede, never rewrite", and `task check:links` fails the build
on any relative link or anchor that does not resolve, ADRs included. The core
specification ([ADR 0022](0022-the-musher-document-core-specification.md)) moves
clauses that accepted ADRs cite. Read literally, the two rules cannot both hold
across that move.

## Decision

### 1. One name: `musher-dev/specifications`, served at `specifications.musher.dev`

Every source `$id`, bundle `$id`, pinned URL, alias URL and catalog entry is on
`https://specifications.musher.dev`. The Cloudflare Pages project keeps its name
(`musher-schemas`), which is an identifier inside `musher-dev/infra` that no
consumer reads.

This is free now and never again. `git tag -l` is empty, `published.json` records
`"releases": {}`, and the manifest reads `0.0.0` for every family.
[ADR 0005](0005-platform-divergence-reconciliation.md) §1 was written for
narrowing validation. Its ground, that nothing published means nothing to migrate
from, holds with more force for an identifier nobody has been served. After the
first tag a pinned `$id` is as immutable as its bytes, and so is its host.

`musher-dev/infra` redirects `schemas.musher.dev` with a `301`. That is a
consequence of this decision, not a contract of this repository: no published
`$id` names the old host, so a validator resolving by identity never meets the
redirect, and nothing here depends on it lasting.

[ADR 0012](0012-cloudflare-pages-publication.md) §1 otherwise stands. The origin
is still Cloudflare Pages; only the hostname differs.

### 2. The family version is the unit of authoring and of release

```
specifications/<family>/v<major>/
  spec.md
  schemas/src/             kind families only
  examples/                kind families only
  conformance/
    cases.json
    <phase>/<case-id>/
  CHANGELOG.md             written by release-please at the first release
conformance/README.md      the fixture-format contract every corpus follows
```

Everything normative about one family version lives under one directory, and
that directory is its release-please package path. A `feat` or `fix` that adds
or corrects a fixture enters that family's next release, like any other change to
what the release asserts. Core
([ADR 0022](0022-the-musher-document-core-specification.md)) has `spec.md` and
`conformance/` only, with no `schemas/src/` and no `examples/`.

Only the corpus's location changes. The case-tree contract of
[ADR 0002](0002-conformance-case-trees.md) and everything in
`conformance/README.md` stand as written, and since `spec.md` does not move, no
`metadata.json` `clause` changes.

`conformance/README.md` stays at the root because it is suite-level: one format
shared by every corpus, which a copy per family would let drift. In the release
archive, `conformance/` stays a top-level directory and carries that README. The
layout is a fact about this repository, and an adapter reading a vendored release
should not have to learn it.

[ADR 0011](0011-tooling-configuration-layout.md) rejected a non-dotted `config/`
because it "would sort with `specifications/` and `conformance/`, which are the
contract". The argument survives: the root `conformance/` now holds only the
fixture format, which is still contract.

### 3. Repository paths are spelled in one module

`tools/src/lib/layout.ts` is the only place a repository path is written. Every
other tool asks it for a family version's directory, prose, sources, examples,
corpus and package key, and a test fails when a path literal appears anywhere
else under `tools/src/` outside the fixture builders in `tools/src/testing/`.

When a tool reads a released ref and a path the layout says that family version
has is absent, the result is an error naming the tag and the path — never `null`,
never an empty list. An empty answer there only ever means the layout and the
tool disagree, and until now the tool's answer to that was success.

The ledger's `path` ([ADR 0006](0006-publication-from-tags.md) §3) stays the
record of where each release's bytes lived. §3 made it required because deriving
a path from a tag name does not survive a layout change, and a release cut under
one layout is read under another through that record, not by guessing.

This is non-normative tooling. It is recorded here because it is what keeps
[ADR 0006](0006-publication-from-tags.md)'s immutability promise from failing
silently the next time a directory moves.

### 4. Accepted ADRs change only by link-target maintenance

> An accepted ADR's prose is immutable. Where a relative link target (path or
> `#fragment`) moves, the target, and only the target, may be rewritten. Link
> text, surrounding prose, status, and relations are never edited. `task
> check:adr` fails any diff to an accepted ADR that is not link-target-only.

The mechanism is textual. For every ADR whose status at the merge base is
Accepted, `check:adr` rewrites each `](target)` to `]()` in both the base and the
head versions and fails if the results differ. Reading the status at the merge
base lets a pull request accept a Proposed ADR without that acceptance counting
as an edit.

By convention, the commit making such a change says so in its subject.
`check:adr` does not read commit subjects; what it enforces is only that the diff
is link-target-only.

This refines [GOVERNANCE.md](../../GOVERNANCE.md#decision-process), which gains a
sentence pointing here, without relaxing it. What an ADR decided, and the words
it decided it in, are as fixed as before. A citation reading "component §6.1"
keeps saying so after the clause moves to core, because that is where the rule
was when the decision was taken; the target beneath it keeps it reachable.

Absolute links into `github.com/musher-dev/spec` are not covered and stay as
written. They resolve through GitHub's rename redirect, and `check:links` never
checked them.

### 5. Each fact has one home

- **The repository artifact naming table** moves from `CLAUDE.md` to
  `docs/conventions.md`. `tools/src/schema/lint.ts` enforces it and every contributor
  needs it; an agent brief is not where a contributor looks. Field and value
  naming stays with [ADR 0007](0007-naming-conventions.md).
- **Generated navigation documents**, `docs/traceability.md` and the ADR index,
  stay committed, because they are read in the repository browser where nothing
  builds. `task check:docs` regenerates them and fails on any difference,
  replacing a staleness step that today exists only inside `ci.yml`.
- **Bytes that are served or attached are never committed.** A committed copy of
  a published artifact is a second, writable one. See
  [ADR 0023](0023-published-bytes-are-immutable-release-assets.md), "Published
  bytes are immutable release assets; the ledger pins the tree".

## Alternatives considered

**`registry/` as the container directory.** Rejected because the word already
means three things here: the resource-type registry
([ADR 0009](0009-resource-type-registry.md) §4, and component
[§6.3](../../specifications/component/v1/spec.md#value-schema)'s "a grammatical
identifier the registry does not name is reserved, not invalid"); the platform's
component registry, whose word decides what counts as published
([blueprint §4.1](../../specifications/blueprint/v1/spec.md#component-reference));
and the published site, which [ADR 0017](0017-generated-field-reference.md) calls
"the registry". A fourth meaning would leave "the registry" in normative prose
resolving to nothing. `specs` was never available: it named the retired
repository ([ADR 0001](0001-canonical-repository-architecture.md),
[ADR 0014](0014-superseded-repository-deletion.md)), and reusing it would make
every surviving reference to that repository ambiguous.

**Keep the corpus at the root and give each package a second path.** It closes
the release defect without moving a fixture. Rejected because every tool,
workflow and `.gitattributes` rule would still spell two mirrored trees, and the
directory a reader opens would still not be the unit released. The defect would
be fixed in configuration and left standing in the tree.

**Keep `schemas.musher.dev`.** It already resolves and costs nothing today.
Rejected because it can never change later: once the first `$id` is pinned, the
host is part of an immutable identity.

**Supersede an ADR to fix its links.** The existing rule, applied literally.
Rejected because the superseding ADR would decide nothing but a path, and the
superseded one would still carry the broken link. `check:links` would then have
to exempt `docs/adr/`, and a citation to a section that no longer exists is worse
than no citation. Linking to commit permalinks instead fails the other way: it
pins a reader to the target's wording as it stood, which after an amendment is
the wording that no longer governs.

## Consequences

- A fixture commit now releases its family. `CONTRIBUTING.md` says which commit
  types enter a release, and the choice matters for a fixture as much as for a
  clause.
- The two byte-sensitive parser fixtures move in the same commit as the
  `.gitattributes` lines naming them. A move without those lines would normalize
  the CRLF case to LF, and it would pass while testing nothing, as the comment in
  `.gitattributes` already records.
- Accepted ADRs keep the old names in their prose — `musher-dev/spec`,
  `schemas.musher.dev`, `conformance/<family>/v1/…` in code blocks. That is what
  immutability means; the generated ADR index points from each to this one.
- `musher-dev/platform`'s conformance harness reads corpus paths and the bundle
  at a ref, and `musher-dev/catalog` reads the bundle committed on `main`. Both
  move — to the colocated and core corpora, and to the alias URL on
  `specifications.musher.dev` — before the committed bundles leave git
  ([ADR 0023](0023-published-bytes-are-immutable-release-assets.md)) and before
  either reads a release.
- This reorganization ships as **one pull request**, with ADRs 0021, 0022 and
  0023 accepted on the branch ahead of the implementation commits.
  [CONTRIBUTING.md](../../.github/CONTRIBUTING.md#proposing-a-structural-change)
  asks for an ADR to be accepted in a pull request of its own before
  implementation begins. This is an explicit, maintainer-approved exception to
  that rule, recorded once, here, and it sets no precedent. The three decisions
  describe one layout, and landing them as one diff means `main` never holds a
  layout no accepted ADR describes.
- `main` accepts squash merges only, so release-please sees that pull request as
  one commit, and its body ends with a `BEGIN_COMMIT_OVERRIDE` block whose
  `feat(core)` entry gives core its first release pull request. The entry carries
  no breaking marker, because no previously valid document is rejected.

## Follow-ups

1. `musher-dev/infra` serves `specifications.musher.dev` and redirects the old
   host before the first tag; it is on
   [ADR 0023](0023-published-bytes-are-immutable-release-assets.md)'s list of
   prerequisites.
