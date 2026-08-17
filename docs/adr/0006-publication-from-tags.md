# ADR 0006: Exact-version schemas are published from tags, not from `main`

- **Status:** Accepted
- **Date:** 2026-08-17
- **Refines:** [ADR 0001](0001-canonical-repository-architecture.md) §4, §5

## Context

[README](../../README.md) tells automation that
`https://schemas.musher.dev/component/v1.2.0/component.schema.json` is
"Immutable forever", and [GOVERNANCE](../../GOVERNANCE.md) says a flawed release
is "superseded, never overwritten". The publication pipeline could not keep
either promise.

`tools/src/site.ts` deleted the whole site tree on every run, then copied the
**current working-tree bundle** to both the moving alias and the exact-version
path, taking the version from the release-please manifest. `site/` is
gitignored, and Pages redeployed the entire tree on every push to `main`. Three
consequences followed:

1. **A pinned URL moved.** After `component/v1.0.0` was tagged, the next
   unrelated merge to `main` republished that merge's bundle at
   `/component/v1.0.0/`.
2. **A pinned URL disappeared.** The manifest holds one version per family, so
   publishing `1.1.0` removed `/component/v1.0.0/` from the deployed tree
   entirely.
3. **The guard that appeared to prevent this could not fire.** `site.ts` refused
   to overwrite an existing pinned directory — but tested a tree it had deleted
   thirty-five lines earlier. It read as protection and was dead code.

A fourth problem sat underneath those. The bundler stamps `$id` with the
family's **alias** URL, and the pinned copy was those bytes verbatim, so every
release declared `"$id": ".../component/v1/component.schema.json"`. In 2020-12
`$id` is the document's canonical identity. Every release therefore claimed the
same identity as the moving alias and as every other release, and a validator
that resolves or caches by `$id` could not tell two pinned versions apart. Even
had the transport been fixed, pinning was defeated at the identity layer.

None of this had bitten yet: no tag existed, and all three families read
`0.0.0`. It would have bitten on the first merge after the first release.

## Decision

### 1. The tag is the byte source for every pinned path

`site.ts` enumerates `<family>/v<MAJOR>.<MINOR>.<PATCH>` tags and extracts each
release's bundle from the tag itself. Every version this repository has ever cut
is reassembled on every deploy, so a pinned URL neither moves when `main` moves
nor vanishes when a newer version ships.

Extraction is a pure `git cat-file`: no tooling runs against the old tree, so a
release whose commit predates a bundler change republishes exactly the bytes
that were released. The decisive property is that this needs **no new write path
into `main`** — `git tag` is the write, and the tag ruleset already blocks
deletion, update, and non-fast-forward server-side.

Tag enumeration deliberately does not go through `discoverFamilies()`. A family
retired from the working tree must keep serving what it published; deleting a
directory is not a way to unpublish, and must not quietly become one.

### 2. A pinned copy carries its own identity

Writing a pinned path restamps `$id` to that exact-version URL. The alias keeps
the alias `$id`, because that is the URL the alias serves. One released version
is one byte sequence with one identity, and the release archive ships those same
bytes so that vendoring the tarball and fetching the URL give an identical file.

### 3. `published.json` records what has been published

A committed, append-only ledger keyed by tag, each entry carrying `path`,
`sourceSha256`, and `publishedSha256`.

It is not primarily a tamper control — git's object model and the tag ruleset
already cover that, and an administrator who can rewrite a tag can also push a
ledger fix. It earns its place for three other reasons:

- **Presence.** Without it, "the tags were never fetched" and "nothing has been
  released" are indistinguishable, and the difference is a silent 404 on every
  pinned URL — failure 2 above, reintroduced by the fix for failure 1. With it,
  a missing tag is a build failure.
- **The historical path map.** `path` is required, not optional. Deriving the
  path from the tag name survives a `v2` directory but not a layout change; the
  ledger is the memory of where the bytes lived in each epoch.
- **A reviewable record.** What this repository can never take back appears in a
  diff, under CODEOWNERS.

Two hashes rather than one, because they answer different questions: did the tag
change, and did the way pinned copies are derived change.

### 4. Entries are written on the release pull request, before the tag exists

`.github/rulesets/main-branch.json` allows only squash merges and sets
`strict_required_status_checks_policy`, so a release branch cannot merge while it
is behind `main`. An entry written on that branch is therefore guaranteed to
describe the bundle in the very commit that gets tagged, with no window in which
`main` moves underneath it.

That is what lets `check:published` treat a tag with no ledger entry as a hard
failure rather than something to tolerate for a while after each release. The
alternatives all leave such a window: release-please's generic updater cannot
compute a hash, and a follow-up commit to `main` needs a pull request, which
needs review.

### 5. Releases publish the site themselves

`pages.yml` gains a `workflow_call` trigger and `release.yml` calls it after the
tag is created.

Both workflows trigger on `push` to `main` and start simultaneously, while
release-please creates the tag partway through its own run. Once pinned paths
come from tags, the Pages run for a release commit would enumerate tags *before
the tag for that release existed* — deploying a tree with no pinned path for the
version just cut, which would then appear only on the next unrelated push.
`on: push: tags:` is not an alternative: release-please tags with
`GITHUB_TOKEN`, and those pushes do not trigger workflows.

### 6. Release assets are verified, not clobbered

`gh release upload --clobber` let a workflow re-run silently replace a published
artifact — the same defect as the site tree, on a different surface. A re-run now
compares bytes against what is already attached and succeeds only if they are
identical. Because the archive build is deterministic, a legitimate re-run always
takes that branch; differing bytes mean either the build stopped being
deterministic or the release was mutated, and both deserve a red build.

## Alternatives considered

**A committed `published/<family>/v<X.Y.Z>/` tree.** Stronger than it looks: git
is content-addressed, so duplicate bundles cost only tree entries, and it works
in shallow clones. Rejected because it creates a second, *writable* copy of an
immutable artifact, protected only by CI and CODEOWNERS, where the tag is
protected by a ruleset. It also needs the identical write automation the ledger
needs, and can drift from the tag — which forces building the cross-check
anyway, at which point it is the ledger plus a redundant copy.

**Write-once object storage (Cloudflare R2).** The correct end state at scale,
and the only option that survives repository write access being compromised. It
also supplies per-object `Cache-Control`, removing the path-shaped edge rule ADR
0001 §5 depends on. Deferred, not rejected: it reverses ADR 0001 §5, moves
publication state out of the repository so "what have we published" stops being
reviewable, introduces a credential path, and makes `task site:build`
non-reproducible locally. It needs a git↔storage reconciler regardless, which is
this ledger by another name.

Revisit when publication outgrows Pages, or when the threat model expands to
repository compromise. The migration is then cheap: iterate the ledger, `HEAD`
each key, upload only what is absent. Write-once falls straight out.

## Consequences

- Merging to `main` no longer changes what any released URL serves. Once a
  family is tagged, its alias tracks the newest release rather than the working
  tree; before that it tracks the working tree, exactly as today.
- Pages needs full history and tags. A shallow checkout is a hard failure with
  an explicit hint, rather than a deploy that quietly unpublishes everything.
- `published.json` is append-only, enforced in CI against the pull request's
  base commit.
- `tools/src/site.test.ts` holds the regression proof: a pinned path that does
  not move when `main` moves, and every released version surviving a later
  release. Both were confirmed to fail against the previous implementation
  before it was replaced.

## Follow-ups

1. Record the Cloudflare cache rule for the versioned path shape in this
   repository. ADR 0001 §5 names it; nothing here verifies it exists.
2. `.github/rulesets/RULESETS.md` claims tag creation is restricted to
   administrators and the release workflow. `release-tags.json` carries no
   `creation` rule — add it or stop claiming it.
3. Narrow the `OrganizationAdmin` bypass on `release-tags.json` to a named
   emergency path. The ledger makes a rewritten tag visible; it does not
   prevent one.
