# ADR 0023: Published bytes are immutable release assets; the ledger pins the tree

- **Status:** Accepted
- **Date:** 2026-09-13
- **Supersedes:** [ADR 0001](0001-canonical-repository-architecture.md) §3, the committed bundle and its drift gate
- **Supersedes:** [ADR 0006](0006-publication-from-tags.md) §1, the tag as byte source; §3, its fields; §5; §6
- **Supersedes:** [ADR 0012](0012-cloudflare-pages-publication.md) §1 and §6, the gates before upload
- **Refines:** [ADR 0001](0001-canonical-repository-architecture.md) §4, for the core train and its gate
- **Refines:** [ADR 0006](0006-publication-from-tags.md) §2, §4
- **Refines:** [ADR 0017](0017-generated-field-reference.md) §3
- **Relies on:** [ADR 0021](0021-repository-organized-around-the-family-version.md)
- **Relies on:** [ADR 0022](0022-the-musher-document-core-specification.md)

## Context

[ADR 0006](0006-publication-from-tags.md) made the tag the byte source for every
pinned URL and `published.json` the record of what was released. Its mechanism
has never run — no tag exists, and the ledger reads `"releases": {}` — and read
end to end, the pipeline could not have cut its first release.

**The committed bundle is a second copy that exists to be drift-checked.**
`check:drift` exists to stop `schemas/dist/` "becoming a second, divergent source
of truth". The copy produces a check whose whole job is to prove it redundant.

**GitHub now holds release assets immutably.** Under ADR 0006 the archive is
attached to a release anyone with write access can edit. Since 2025-10-28 a
published immutable release's assets and tag cannot change, and each asset has a
recorded `digest`, so assets must be attached to a draft. The setting is off here.

**Five defects would have stopped the first release.**

1. **The release pull request never runs its required checks.** release-please
   uses `GITHUB_TOKEN`, whose pushes trigger no workflow, so `Lint`, `Schema`,
   `Site Build` and `Signed off` never report and `release-ledger.yml` never runs.
   It cannot merge without spending the bypass
   [ADR 0015](0015-selective-code-owner-review.md) took out of the daily workflow.
2. **The release commit carries no sign-off.** release-please adds none by
   default — `611192e0` on the open component release pull request has none — and
   `dco.yml` requires a real `Signed-off-by` from a bot as from anyone
   ([ADR 0016](0016-dependency-update-policy.md) §1).
3. **The title fails `lint-pr`.** `chore(main): release <family> 1.0.0` uses a
   scope that is not allowed, and under ADR 0016 §4 it is the subject that lands.
4. **`record` never refreshes a pending entry.** It skips a tag already in the
   ledger, so a release branch updated from `main` keeps stale hashes.
5. **The tags endpoint cannot see a draft.** It returns published releases only.

A release cut before [ADR 0021](0021-repository-organized-around-the-family-version.md)
moves the host would stamp the old one into an `$id` served forever, and
[ADR 0022](0022-the-musher-document-core-specification.md) requires each kind
family release to record a core edition the ledger has no field for. ADR 0006 §3
also says the ledger is "under CODEOWNERS"; it is not, and stays so (ADR 0015 §2).
Nothing is released, so the [ADR 0005](0005-platform-divergence-reconciliation.md)
§1 window lets the ledger change shape without a migration.

## Decision

### 1. Bundles are build output

`task bundle` writes `dist/<family>/<major>/<family>.schema.json`; `dist/` is
gitignored, and the committed `schemas/dist/` directories and root `catalog.json`
are deleted. Sources, self-containment, and the ban on remote `$ref` are unchanged.
`check:generated` replaces `check:drift` and asserts only that no build output is
tracked; generated documents that stay committed are `check:docs`'s
([ADR 0021](0021-repository-organized-around-the-family-version.md) §5). CI
publishes the bundle diff against the base commit to the step summary and uploads
`dist/` as an artifact, so review keeps the bytes.

### 2. A release is a draft, then assets, then an immutable publication

`.github/release-please/config.json` gains:

```json
"draft": true,
"force-tag-creation": true,
"pull-request-title-pattern": "chore(repo): release${component} ${version}",
"signoff": "<app-slug>[bot] <<bot-user-id>+<app-slug>[bot]@users.noreply.github.com>"
```

**Draft**, because an immutable release accepts no asset once published.
**Forced tag**, because a draft otherwise gets its tag only when published, and
the release job, `check:published` and release-please all need it at the merge
commit. **The title** passes `lint-pr`, and `chore` counts toward no train. **The
sign-off** MUST match the App's commit author. `dco.yml` accepts a trailer equal to
the author's `Name <email>`, or, when the author name ends in `[bot]` and its
address in `[bot]@users.noreply.github.com`, one naming the same author at any
address; anything else fails `Signed off`.

release-please and the ledger push authenticate as a GitHub App, whose pushes
trigger workflows: the release pull request runs every required check, and the
ledger commit re-runs them. `record` is idempotent, so nothing loops.
`release-ledger.yml` acts only on same-repository release-please branches, mints
its token after `record` for the push alone, and signs its commit off as the App
identity under the same rule.

On merge, release-please tags the merge commit and creates a draft. The release
job checks out the tag and installs the Bun version the tag's own
`tools/.bun-version` names, which every workflow now reads, so a recovery
dispatched from a newer `main` runs the tag's tooling on its own runtime. Per
released path it then:

1. refuses unless immutable releases are enabled, since enabling them later
   protects no release already published;
2. runs `task release:stage`, which checks the tag's entry against `main`'s and
   against `tree`, runs the tagged core gate (§5), and refuses unless a rebuilt
   pinned bundle hashes to `bundleSha256`;
3. stages and attests the bundle and archive (§6) and uploads them to the draft;
4. publishes, not marked latest since four trains share one repository, and
   asserts the release is immutable and each asset's `digest` matches.

### 3. The ledger records the tree, one hash, and what the release requires

```json
{
  "version": 2,
  "releases": {
    "component/v1.0.0": {
      "bundleSha256": "<sha256 of the bytes served at the pinned URL>",
      "path": "specifications/component/v1",
      "requires": { "core": "1.0.0" },
      "tree": "<git tree id of path at the tagged commit>"
    },
    "core/v1.0.0": { "bundleSha256": null, "path": "specifications/core/v1", "tree": "<git tree id>" }
  }
}
```

- **Keys** are release tags, serialized as sorted canonical JSON.
- **`path`** keeps ADR 0006 §3's job as the memory of where each epoch lived, but
  names a directory, since no bundle is in git.
- **`tree`** is git's tree id for `path` at the tagged commit: prose, sources,
  examples and corpus in one value computed by git, not by this repository.
- **`bundleSha256`** hashes the bytes served at the pinned schema URL, which are
  the asset's bytes. It is `null` exactly when the family publishes no schema.
- **`requires`** maps family names to exact versions. It is required on every
  kind family entry and forbidden on core's; `requires.core` is core's manifest
  version when the entry is recorded.

ADR 0006 §3's second hash asked whether derivation changed, which stops being a
question: pinned bytes are derived once, by the tag's tooling (§7). ADR 0006 §4 is
refined, not replaced. Entries are still written on the release pull request, and
a squash merge of an up-to-date branch still yields the head's tree. `record` now
*inserts or updates* pending entries, those whose tag does not exist, and never
rewrites a tagged one. `check:ledger` permits the version 1 → 2 rewrite only
because the base ledger is empty.

### 4. Verification is offline against git and online against GitHub

**Offline**, `task check:published` checks a tagged entry by tree — `<tag>:<path>`
must equal `tree`, and the tag's own ledger must hold the same entry — and never
rebuilds it. A pending entry is rebuilt and compared: `tree` against
`HEAD:<path>`, `bundleSha256` against a fresh pinned build. The core gate (§5)
runs on both. A tag with no entry fails, as does a shallow clone that holds a
non-empty ledger but no tags.

**Online**, `task site:fetch` asks the tags endpoint for each tagged release, and
requires it published and immutable, its conventional assets present, the
bundle's `digest` equal to `sha256:<bundleSha256>`, and downloaded bytes with that
hash. A published release with no ledger entry fails. After a deploy,
`task site:verify-live` compares every pinned URL and alias on the origin. No
release is rebuilt by newer tooling.

### 5. A kind family release waits for core's releasable changes

A **releasable commit** touches `specifications/core/v1` and is releasable as
[ADR 0022](0022-the-musher-document-core-specification.md) §7 defines. The gate
classifies commits from `git log` by the configuration release-please reads, so
for commits without a `BEGIN_COMMIT_OVERRIDE` the two cannot disagree. An override
lives in the pull request body, which the squash commit does not carry. After
core's first release, a pull request touching `specifications/core/` therefore
MUST NOT use one; that is a review obligation, not a check. The reorganization
pull request uses one before any core tag exists.

A **pending** kind family entry fails when core's manifest reads `0.0.0`, when
`core/v<requires.core>` is missing, or when
`git log core/v<requires.core>..HEAD -- specifications/core/v1` holds a
releasable commit. Non-releasable core commits only warn, for the reason ADR 0022
§7 gives, as does a `requires.core` that trails core's manifest. A **tagged** kind
family entry requires `core/v<requires.core>` to be an ancestor of the family tag,
no releasable core commit between them, and `requires.core`'s major to match the
core line the family's `spec.md` cites.

### 6. A kind family archive carries the core it was built against

The kind family archive holds the bundle, `spec.md`, `examples/`, `conformance/`,
`LICENSE`, `NOTICE`, `core/spec.md`, `core/conformance/`, and a `release.json`
naming the release and its core edition. The core archive holds `spec.md`,
`conformance/`, `LICENSE`, `NOTICE` and `release.json`. In both, `conformance/` is
top-level and includes the fixture-contract `conformance/README.md`
([ADR 0021](0021-repository-organized-around-the-family-version.md) §2).

Core files are read from `core/v<requires.core>`, **not** from the family tag's
tree, which §5 allows to differ by non-releasable commits, so a conformance claim
is reproducible from the archive alone. The tar and gzip flags are unchanged;
determinism becomes a unit test rather than ADR 0006 §6's rerun comparison,
because GitHub refuses a change to a published asset.

### 7. The site serves pinned paths only from verified assets

`task site:build` reads pinned bytes only from what `site:fetch` verified, and a
miss throws. Releases are enumerated from the ledger, so a family retired from the
working tree keeps serving what it published, as ADR 0006 §1 required.

ADR 0006 §2 is refined by reversing its direction: the pinned bundle is canonical,
and a released major's alias is its verified bytes with `$id` restamped; an
unreleased major's alias is built from the working tree. A pinned bundle keeps its
`<family>.schema.json.sha256` sidecar on the site
([ADR 0012](0012-cloudflare-pages-publication.md) §2, §4), computed from the
verified bytes; no sidecar is uploaded as an asset.

ADR 0017 §3 keeps its guarantee and loses its mechanism: a released reference is
built from the verified pinned bytes, with prose and examples read at the tag
under the ledger's `path`. Core gets prose-only pages, with no schema path, alias
or `_headers` rule.

### 8. One deploy per push, as the last job of `release.yml`

`pages.yml` becomes `deploy.yml`, run only by `workflow_call` and
`workflow_dispatch`. `release.yml` runs on every push to `main` and calls it last,
unless the run was cancelled or the release job failed, so every push deploys once,
after any release it cut is published. The race ADR 0006 §5 worked around is gone,
and its rejection of `on: push: tags:` survives for a new reason: an App's tag push
would trigger it before the assets exist. The gates before the upload in ADR 0012
§1, and the same sentence in its §6, become `check:published` and `site:fetch`.

### 9. A failed release is recovered by dispatching its tag

`release.yml` accepts `workflow_dispatch` with a `tag` input. It finds the release
by listing releases, and does what is undone: recreates a missing draft, replaces
a draft asset whose bytes differ, and only verifies a published release. There is
no `withdrawn` state; a release is corrected by a superseding version.

## Alternatives considered

**An App commit to `main` after publication**, recording actual digests. It needs
a bot bypass on `main-branch`, which ADR 0015 rejected, and reopens ADR 0006 §4's
window in which a tag exists with no entry.

**Predict the archive's hash on the release pull request.** `release.json` records
a merge commit that does not yet exist, and the hash would bind the ledger to the
runner's `tar` and `gzip`. `tree` and `bundleSha256` pin the inputs instead.

**Keep the committed bundle and also publish assets.** Two byte sources for one
URL and a gate proving they agree, which is the defect in Context.

**A nightly reconciler.** Every push already deploys and verifies every release.
A schedule adds a token-holding workflow that fails quietly in weeks nobody pushes.

**Mirror to write-once object storage (R2).** Deferred, for the reasons ADR 0006
and ADR 0012 gave. Immutable releases supply write-once assets without a new
credential path.

## Consequences

**Positive**

- Each released URL has one byte source, verified in git and on GitHub.
- No release step spends the `OrganizationAdmin` bypass.
- A kind family release names the core edition it implements and ships it.

**Negative**

- **Deploys depend on the GitHub API.** An outage blocks deploys while the origin
  keeps serving, and a local `site:build` needs the network for released versions.
- **Reviewers read generated bytes in the step summary and artifact,** not the diff.
- **A failed release blocks every deploy until recovered** (§9), because deploying
  without it would drop a pinned path.
- **A kind family can wait on core** while core's release pull request is unmerged.
- **Prerequisites before the first tag:** enable immutable releases; disable the
  stale GitHub Pages site; create the release App (contents and pull requests
  read-write, administration read so the release job can confirm immutability)
  and its credentials, and replace the `signoff` placeholder with its identity —
  the release job refuses to run until they match; apply the
  `release-tags` ruleset with `refs/tags/core/**`; serve the new host and redirect
  the old one; pass a scratch-repository rehearsal; release core first.

## Follow-ups

1. Add a `withdrawn` ledger marker if a release must ever stop being served rather
   than superseded.
2. [ADR 0012](0012-cloudflare-pages-publication.md) follow-up 1, `Deprecation` and
   `Sunset` headers, stays open; the ledger is still where the fact would live.
3. Verify provenance attestations in `site:fetch`.
