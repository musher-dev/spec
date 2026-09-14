# Publication

How a change on `main` becomes a released, immutable family version served at
`https://specifications.musher.dev`. [Draft or released](#draft-or-released)
and [Release assets](#release-assets) are for anyone reading or consuming a
version. The rest describes the pipeline as it runs, for maintainers. The policy
it implements lives in
[Governance → Release process](governance.md#release-process), and the
reasoning behind it lives in
[ADR 0006](adr/0006-publication-from-tags.md) and
[ADR 0023](adr/0023-published-bytes-are-immutable-release-assets.md).

## From commit to release

Every family version is a release-please package, and core is one too:
`specifications/core/v1`, `specifications/component/v1`,
`specifications/blueprint/v1` and `specifications/listing/v1`. Each has its own
release line, tagged `<family>/v<MAJOR>.<MINOR>.<PATCH>`.

1. **Release pull request.** Every push to `main` runs `release.yml`.
   release-please authenticates as the release GitHub App and opens or updates
   one pull request per package that has releasable commits
   ([CONTRIBUTING → Commit messages](../.github/CONTRIBUTING.md#commit-messages)).
   It titles each `chore(repo): release <family> <version>` and signs it off as
   the App. The App token matters here, because a push made with `GITHUB_TOKEN`
   triggers no workflow, and a release pull request would then never report its
   required checks.
2. **Ledger entry.** Until its version is recorded, the release pull request is
   red: `task check:published` fails on a manifest version, other than `0.0.0`,
   that is neither tagged nor in `published.json`. `release-ledger.yml` runs
   `task release:record` on that pull request. For each manifest version that
   has no tag yet, it inserts or updates the pending entry in `published.json`,
   applying the [core gate](#the-core-gate). It then commits and pushes as the
   App, with git hooks disabled (`-c core.hooksPath=/dev/null` and
   `--no-verify`), so no hook runs while the App token is in scope. That push
   re-runs the required checks, and `task check:published` re-derives the entry
   and fails if it is stale.
3. **Tag and draft.** The release pull request squash-merges, and the strict
   status policy means its branch is up to date first. release-please tags the
   merge commit and creates a **draft** GitHub Release. The tag is forced at
   merge because a draft would otherwise get its tag only when published.
4. **Stage.** The `artifacts` job refuses to continue unless immutable releases
   are enabled on the repository. It checks out the tag and applies the **tag
   guard**: on a push, the tag's commit must be an ancestor of the pushed commit
   (`GITHUB_SHA`), because a later push may pick up the release an earlier merge
   tagged; on a dispatch, it must be an ancestor of `origin/main`. Either way the
   tag must be on the default branch. The job installs the Bun version named in
   the tag's own `tools/.bun-version`, and runs
   `task release:stage TAG=<tag>` on the tag's own tooling, which:
   - requires the tag's ledger entry to equal the entry in the default branch's
     ledger, read at `origin/main`, or at `BASE_LEDGER_REF` when that is set;
   - requires `<tag>:<path>` to hash to the recorded `tree`;
   - requires `examples/` at the tag for a kind family;
   - runs the tagged core gate;
   - rebuilds the pinned bundle and requires its SHA-256 to equal `bundleSha256`;
   - stages the assets into `dist/release/`.
5. **Attest and upload.** Every staged file gets a SLSA provenance attestation
   and is uploaded to the draft.
6. **Publish immutable.** The job publishes the draft, without marking it
   latest, since four release lines share the repository. It then reads the
   release back and requires `immutable: true` and each asset's `digest` to equal
   the local file's SHA-256. From here on, neither the tag nor the assets can
   change.
7. **Deploy.** The last job of `release.yml` calls `deploy.yml`, which runs, in
   order, `task check:published`, `task site:fetch`, `task site:build`,
   `task site:deploy` and `task site:verify-live`. It runs on every push, after
   any release that push cut, when the run was not cancelled and the `plan` and
   `artifacts` jobs each succeeded or were skipped. A failed `release-please`
   job does not block it: nothing partial exists when release-please fails, so
   `main` still deploys, and the failure is reported red on its own job. Both
   `release.yml` and `deploy.yml` refuse a manual dispatch from any ref other
   than `refs/heads/main`.

### <a id="release-assets"></a>Release assets

| Release | Assets |
|---|---|
| Kind family (`component`, `blueprint`, `listing`) | `<family>.schema.json`, `<family>-v<X.Y.Z>.tar.gz` |
| Core | `core-v<X.Y.Z>.tar.gz` |

`<family>.schema.json` is the pinned bundle, carrying the exact-version `$id`.
It holds the same bytes the site serves at the pinned URL.

Every archive unpacks into one top-level directory, `<family>-v<MAJOR>/`, such
as `component-v1/`. A kind family archive's directory holds:

- the bundle, `spec.md`, `examples/` and `conformance/`;
- `core/spec.md` and `core/conformance/`, read from the `core/v<requires.core>`
  tag rather than from the family's own tree;
- `LICENSE`, `NOTICE` and `release.json`, which names the tag, the commit and
  the core edition.

A core archive's directory holds `spec.md`, `conformance/`, `LICENSE`, `NOTICE`
and `release.json`. In both archives, `conformance/` carries the fixture format,
[docs/conformance.md](conformance.md), as `conformance/README.md` beside the corpus.
Archives are deterministic: fixed tar ordering, owner and mtime, and `gzip -n`.

How to check an asset's digest and provenance is in
[SECURITY.md → Verifying a release](../.github/SECURITY.md#verifying-a-release).

Every check builds bundles in memory. `task bundle` writes them to `dist/` only
for reading, vendoring and editor bindings. CI also uploads `dist/` as a build
artifact, and writes the bundle diff against the base commit to the job summary.

## <a id="draft-or-released"></a>Draft or released

A family version is **released** when all three of these hold:

- the tag `<family>/vX.Y.Z` exists;
- `published.json` has an entry for it;
- a published, immutable GitHub Release for that tag carries assets that match
  the entry.

Anything else is a draft. `spec.md` on `main` is the draft of its line's next
version, and it may change until that version is tagged.

To see what is released, read `published.json` or run
`git tag -l '<family>/*'`. The site's index pages say the same, per family.

To read the prose of a released version rather than the draft, use any of:

- the rendered page, `https://specifications.musher.dev/reference/<family>/v<X.Y.Z>/spec/`,
  built from the tag;
- `spec.md` inside the release archive;
- git: `git show <family>/v<X.Y.Z>:<path>/spec.md`, where `<path>` is the
  ledger entry's `path`, today `specifications/<family>/v<MAJOR>`.

The site's pages exist once the first deploy has run.

The alias `/<family>/v<N>/<family>.schema.json` serves the newest release of
that major, with its `$id` restamped to the alias URL. Before a major's first
tag, the alias is built from `main`, so it moves with every push.

## What the site serves

`task site:build` assembles `site/`, and `task site:deploy` uploads it to the
Cloudflare Pages project behind `specifications.musher.dev`.

| Path | Source |
|---|---|
| `/<family>/v<X.Y.Z>/<family>.schema.json` | The verified release asset, byte for byte |
| `/<family>/v<X.Y.Z>/<family>.schema.json.sha256` | `sha256sum`-format sidecar, computed from the verified bytes |
| `/<family>/v<N>/<family>.schema.json` | Newest release, `$id` restamped; the working tree before the first tag |
| `/<family>/versions.json` | Every released version of the family |
| `/catalog.json` | Editor discovery catalog, naming each family's alias URL |
| `/published.json` | The ledger |
| `/index.html`, `/<family>/index.html`, `/404.html` | Generated index pages |
| `/reference/…` | Generated field reference and rendered prose, per served version |

Pinned bytes come only from what `task site:fetch` verified into
`.cache/releases/`, and a missing entry fails the build. Releases are listed
from the ledger, not from the working tree, so a family version removed from
`main` keeps serving what it published. A released version's reference page is
built from its verified bundle, with prose and examples read at its tag under
the ledger's `path`.

**The draft window.** release-please tags a merge commit before the release job
publishes its release, so for a few minutes a tagged entry has no published
release. CI's `Site Build` sets `ALLOW_PENDING_RELEASES=1`: there, such an entry
is a warning, and its release is left out of the site CI builds. The deploy sets
no such variable, and fails on it.

**Core is prose-only.** It publishes no schema, so it has index and reference
pages but no pinned path, no alias, no `versions.json` and no `_headers` rule.

Everything under `/reference/` and every index page is informative, and is
regenerated on every deploy. No release archive carries the HTML.

## <a id="cache-policy"></a>Cache policy

`site.ts` generates `_headers` from the same enumeration that writes the tree,
so a path's cache policy cannot drift from the path itself.

| Path | Header |
|---|---|
| Every path | `Access-Control-Allow-Origin: *`, `X-Content-Type-Options: nosniff` |
| `*.schema.json` | `Content-Type: application/schema+json; charset=utf-8` |
| `*.sha256` | `Content-Type: text/plain; charset=utf-8` |
| `/<family>/v<X.Y.Z>/*` | `Cache-Control: public, max-age=31536000, immutable` |
| Alias bundles, `versions.json`, `catalog.json`, `published.json` | `Cache-Control: public, max-age=300, must-revalidate` |
| Index pages, `/reference/` | No rule. Pages serves `Cache-Control: public, max-age=0, must-revalidate` |

Open CORS means a browser-based validator can fetch a schema directly, and an
alias is revalidated within five minutes of a release. Cloudflare Pages applies
every matching rule and comma-joins duplicate header names, so no two rules may
set the same header on one path. The build fails if two do, and it also fails at
ninety rules, below Pages' limit of one hundred. `Deprecation` and `Sunset`
headers are not generated yet
([ADR 0012](adr/0012-cloudflare-pages-publication.md), follow-up 1).

The reasoning is in [ADR 0012 §2](adr/0012-cloudflare-pages-publication.md) and
[ADR 0017 §4](adr/0017-generated-field-reference.md).

## The ledger

`published.json` at the repository root records every version ever released.

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

| Field | Meaning |
|---|---|
| key | The release tag. Keys are sorted, and the file is canonical JSON. |
| `path` | The family version directory at that release. A release is read through this field, which is how it survives a later layout change. |
| `tree` | Git's tree id for `path` at the tagged commit. It covers prose, sources, examples and corpus in one value. |
| `bundleSha256` | SHA-256 of the pinned bundle, which is also the release asset. `null` exactly when the family publishes no schema, which today means core. |
| `requires` | Exact versions of the families this release was built against. Required on a kind family entry, and forbidden on core's. `requires.core` is core's manifest version when the entry is recorded. This is where a release's core edition is recorded; the archive's `release.json` repeats it. |

**The ledger is append-only.** An entry is *pending* until its tag exists, and
*tagged* after that. `task release:record` inserts or updates pending entries
on a release pull request. Nobody edits the file by hand, which is a convention
rather than a check. `task check:ledger` compares the file against the pull
request's base commit and fails if any entry the base holds was edited or
removed, pending entries included.

A pending entry reaches `main` when its release pull request merges, and from
then on it is as fixed as a tagged one. release-please tags that merge commit in
the same run, so the entry normally becomes tagged at once. If no tag is
created, the entry stays pending on `main`: `task check:published` keeps
rebuilding it against `HEAD`, and fails once a later commit changes its `path`.

The checks that read the ledger:

- **`task check:published`** runs offline, against git.
  - A tagged entry is verified by three things only: `<tag>:<path>` must equal
    `tree`, the tag's own `published.json` must hold the same entry, and a kind
    family's `core/v<requires.core>` must be an ancestor of the tag. Nothing
    else is re-run against tagged history. Commit classification ran while the
    entry was pending, and `task release:stage` ran it again on the tag's own
    tooling, so newer tooling never re-judges it.
  - A pending entry is rebuilt, must match `HEAD` and a fresh pinned build, and
    must pass the pending core gate.
  - A manifest version other than `0.0.0` that is neither tagged nor recorded
    fails.
  - A tag with no entry fails.
  - A shallow clone holding entries but no tags fails, rather than reporting
    nothing to check.
- **`task check:ledger`** is the append-only check above. It runs in CI's
  `Site Build`, on pull requests only.
- **`task check:published:online`** runs the online half of `task site:fetch`
  without writing the cache. For each tagged entry, the GitHub Release must be
  published and immutable, carry its conventional assets, and have a bundle
  `digest` equal to `sha256:<bundleSha256>`, and the downloaded bytes must hash
  to that value. A published release with no ledger entry also fails.
- **`task site:verify-live`** fetches every pinned URL and alias from the origin
  after a deploy, and compares hashes.

A tagged release is never rebuilt by newer tooling. Its tree is checked in git,
and its bytes are checked on GitHub.

## The core gate

A kind family release records the core edition it was built and tested against
([core v1 §9](../specifications/core/v1/spec.md#editions)). The gate keeps that
record true. The pending gate runs in `task release:record`,
`task check:published` and `task check:editions`. The tagged gate runs in
`task release:stage`, on the tag's own tooling.

**A releasable core commit** touches `specifications/core/v1` and either:

- has a type that release-please's changelog shows: `feat`, `fix` or `docs`, per
  `.github/release-please/config.json`;
- is breaking: `!` after the type or scope, or a `BREAKING CHANGE:` or
  `BREAKING-CHANGE:` footer;
- or carries a `Release-As:` footer.

A footer counts only in the commit message's trailer block, its last paragraph.
The same words elsewhere in the body do not count. Merge commits are ignored, and
so is a releasable commit that does not touch core.

A **pending** kind family entry fails when any of these hold:

- the family's `spec.md` is missing, or its §2 "Normative dependencies" table
  cites no core line;
- core's manifest version is `0.0.0`, meaning core has never been released;
- `requires.core` belongs to a different core line than the one §2 cites;
- `requires.core` is ahead of core's manifest version;
- the tag `core/v<requires.core>` does not exist;
- `git log core/v<requires.core>..HEAD -- specifications/core/v1` contains a
  releasable commit.

A **tagged** kind family entry, staged by `task release:stage`, fails unless all
of these hold:

- `core/v<requires.core>` is an ancestor of the family tag;
- no releasable core commit lies between the two;
- the major version of `requires.core` matches the core line the family's
  `spec.md` cites at the tag.

**Warnings, not failures.** A non-releasable core commit since the recorded
edition (`chore`, `refactor`, `test` and the like) warns. So does a
`requires.core` that trails core's manifest version. release-please opens no core
release for a hidden type, so blocking on one would hold every family until
someone manufactured a releasable core commit.

**No commit override on core.** The gate reads commits from `git log`, so it
cannot see a `BEGIN_COMMIT_OVERRIDE` block. The rule that follows from that is in
[CONTRIBUTING → Squash merges and overrides](../.github/CONTRIBUTING.md#squash-merges-and-overrides).

## When a release is wrong

A release is never overwritten. Its tag cannot be moved or deleted, its assets
cannot change, and its ledger entry cannot be edited. Correct it forward:

1. **Supersede.** Fix the defect on `main` with a `fix` commit, and release the
   patch through the normal flow.
2. **Deprecate.** Mark the flawed version as
   [Governance → Deprecation and retirement](governance.md#deprecation-and-retirement)
   describes, and point at the superseding version.

There is no `withdrawn` state, so a published version keeps serving
([ADR 0023](adr/0023-published-bytes-are-immutable-release-assets.md),
follow-up 1).

## Recovery

If `release.yml` fails after the tag exists but before the release is
published, the version is tagged but not released. Every deploy then fails at
`task site:fetch`, because deploying without the release would drop a pinned
path. Recover by dispatching the release workflow from `main` with the tag:

```sh
gh workflow run release.yml --repo musher-dev/specifications --ref main -f tag=component/v1.2.0
```

A dispatched run skips release-please, finds the release by listing releases,
and does only what is undone:

- recreates a missing draft;
- replaces any draft asset whose bytes differ;
- verifies a release that is already published, without changing it.

It checks out the tag and uses the tag's tooling and Bun version, so a dispatch
from a newer `main` still builds what the tag describes. The tag guard requires
the tag to be an ancestor of `origin/main`. Re-running it is safe.

## Prerequisites before the first tag

These live outside the repository. Each must be in place before any family,
starting with core, is tagged:

1. **Enable immutable releases** on the repository. The release job refuses to
   run without them, because enabling them later protects no release already
   published.
2. **Disable GitHub Pages** on the repository. The origin is Cloudflare Pages,
   and a stale Pages site must not answer for the same content.
3. **Keep the squash-merge settings.** `main` accepts squash merges only, and
   two repository settings decide what the squash commit says. Neither is a
   ruleset field, so nothing in `.github/rulesets/` can carry them. Check both
   with
   `gh api repos/musher-dev/specifications --jq '{squash_merge_commit_title, squash_merge_commit_message}'`.
   - `squash_merge_commit_title` must be `PR_TITLE`. `task check:title`
     validates the pull request title, and release-please and the core gate read
     the merged subject, so the two must be the same string. Under the default,
     a single-commit pull request lands that commit's subject instead
     ([RULESETS.md](../.github/rulesets/RULESETS.md#the-selective-code-owner-review-gate),
     invariant 7).
   - `squash_merge_commit_message` must be `COMMIT_MESSAGES`. The squash body
     is then the branch's own commit messages, the text the `commit-msg` hook
     and `Signed off` read, and its trailer block is the end of the branch's last
     commit. That is where a `BREAKING CHANGE:` or `Release-As:` footer has to
     sit to count. `PR_BODY` would land the pull request description, which no
     check reads, and `BLANK` would drop every footer.
4. **Create the release GitHub App.** Grant it Contents read and write, Pull
   requests read and write, and Administration read, which the release job uses
   to confirm immutable releases are enabled before it publishes. GitHub adds
   Metadata read to every App. Install it on this repository, then record its
   client ID, shown on the App's settings page, as the repository variable
   `RELEASE_APP_CLIENT_ID`, and its private key as the repository secret
   `RELEASE_APP_PRIVATE_KEY`. The numeric App ID is not what the token action
   reads.
5. **Set the release sign-off.** The `signoff` in
   `.github/release-please/config.json` holds a placeholder:

   ```
   RELEASE_APP_SLUG[bot] <RELEASE_APP_BOT_USER_ID+RELEASE_APP_SLUG[bot]@users.noreply.github.com>
   ```

   Replace both `RELEASE_APP_SLUG` occurrences with the App's slug, and
   `RELEASE_APP_BOT_USER_ID` with its bot user id, which
   `gh api users/<slug>[bot] --jq .id` prints. Before release-please runs, the
   release job compares the value on the default branch with the App's commit
   author, and it refuses to continue until they match, because every release
   pull request would otherwise fail `Signed off`.
6. **Serve `specifications.musher.dev` from Cloudflare Pages.** Attach the
   custom domain to the Pages project `task site:deploy` names. Store a token
   scoped to that one project as `CLOUDFLARE_API_TOKEN`, and the account as
   `CLOUDFLARE_ACCOUNT_ID`.
7. **Redirect the old host.** `schemas.musher.dev` is being retired. Once the
   redirect is in place, it answers with a `301` to the same path on
   `specifications.musher.dev`. No published `$id` names the old host, so
   nothing here depends on the redirect lasting.
8. **Apply the updated `release-tags` ruleset**, which covers
   `refs/tags/core/**`, with `gh api -X PUT` as
   [RULESETS.md](../.github/rulesets/RULESETS.md) shows.
9. **Rehearse** the whole flow in a scratch repository, then release core
   before any kind family.
