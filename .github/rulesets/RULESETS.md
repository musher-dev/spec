# Repository rulesets

These JSON files are the version-controlled source of the repository's branch
and tag protection. GitHub is the live system; this directory is the reviewable
record of what it should say.

The organisation-level rulesets do not fully cover this repository:
`branch-protection` applies to `~ALL` repos (it blocks deletion and
non-fast-forward pushes), but `pr-workflow` targets a hardcoded repo list
written in March 2026 that predates this repository. These repo-level rulesets
close that gap and add the parts specific to a specification repository —
notably immutable tags.

## Applying

```sh
gh api -X POST repos/musher-dev/spec/rulesets \
  --input .github/rulesets/main-branch.json

gh api -X POST repos/musher-dev/spec/rulesets \
  --input .github/rulesets/release-tags.json
```

To update an existing ruleset, find its id and `PUT` instead:

```sh
gh api repos/musher-dev/spec/rulesets --jq '.[] | "\(.id)\t\(.name)"'
gh api -X PUT repos/musher-dev/spec/rulesets/<id> \
  --input .github/rulesets/main-branch.json
```

## `main-branch.json`

Protects the default branch:

- **Pull request required**, with **no blanket approval** and **code-owner
  review required** — see the next section, which is the whole point of the
  file.
- **Linear history**, squash-merge only. The specification's history should read
  as a sequence of deliberate changes.
- **Required status checks**: `Lint`, `Schema`, `Site Build`, `Signed off`,
  each pinned to `integration_id: 15368` so only the GitHub Actions app can
  satisfy them. `Schema` is the one that matters most — it carries the bundle
  drift gate. `Site Build` carries the publication-ledger gates. `Signed off`
  is the DCO check CONTRIBUTING.md requires.
- **Deletion and force-push blocked.**

### The selective code-owner review gate

Two parameters are paired deliberately, and neither means anything alone:

```json
"required_approving_review_count": 0,
"require_code_owner_review": true
```

A pull request touching no path in `.github/CODEOWNERS` merges on green CI; one
touching an owned path also needs that owner's approval, with every review
thread resolved. `0` is GitHub's sanctioned "no blanket reviewers" value, and
the code-owner requirement is evaluated per changed file.
[ADR 0015](../../docs/adr/0015-selective-code-owner-review.md) says why.

Six invariants keep the mechanism working. Each one breaks it *silently* — the
first four are checked by `task check:rulesets` (RUL-05..RUL-09); the last two
are only visible against live GitHub state:

1. **No `*` catch-all in `.github/CODEOWNERS`.** It makes every pull request
   code-owned, which is the blanket gate again wearing a different hat.
2. **`require_last_push_approval` stays `false`.** With zero required approvals
   it produces a self-contradictory, unmergeable state.
3. **Every required context must name a job some workflow publishes**, and that
   workflow must not filter on `paths:`. Either mistake yields a context that
   never reports and a pull request that hangs forever. This is why the
   validator runs inside the existing `Lint` job rather than as a workflow of
   its own.
4. **Every root-anchored CODEOWNERS pattern must resolve to a real path.**
   CODEOWNERS fails open: a stale entry reads as ownership and grants none. So
   does an owner without explicit write access, or an invisible team.
5. **No classic branch protection rule may coexist on `main`.** Classic rules
   and rulesets aggregate most-restrictive, so a leftover rule requiring one
   approval silently restores blanket review. `gh api
   repos/musher-dev/spec/branches/main/protection` must return `404`.
6. **No org-level ruleset may impose an approval count on this repository.**
   Same aggregation. `spec` is deliberately absent from the org `pr-workflow`
   ruleset's include list; do not add it.

**An owner's own pull requests are exempt.** GitHub cannot request a review from
the author, so authorship waives the requirement for the patterns that author
owns. The gate protects owned paths from *other* contributors, not from their
owner. `.github/workflows/codeowners-notice.yml` posts a sticky comment on
self-owned edits so the waiver is at least visible.

### Changing the review gate

The aggregation traps in invariants 5 and 6 are undetectable offline, so a
change to the `pull_request` rule runs this sequence rather than just an apply:

1. Reconcile any drift first (see below); do not layer a change on top of one.
2. `gh api repos/musher-dev/spec/branches/main/protection` — a `404` is the
   desired answer.
3. `gh api repos/musher-dev/spec/rules/branches/main` lists every rule that
   actually applies, whatever its source. Confirm no org-sourced `pull_request`
   rule carries a nonzero `required_approving_review_count`.
4. Apply via the `PUT` recipe above.
5. Verify **both directions** with two throwaway pull requests: one touching no
   owned path must show zero approvals required and merge on green CI; one
   touching `.github/rulesets/` must block awaiting a code owner. Open the
   second from a non-owner account, since an owner's own pull request is waived
   by design.

### Detecting drift

Drift is the live ruleset diverging from these files because someone edited it
in the UI. `task check:rulesets` cannot see it: the default `GITHUB_TOKEN` lacks
`administration: read`, so a workflow-based detector would need a long-lived
secret or would fail open. It is an operator check — run it during a security
review, or whenever review behaviour surprises you:

```sh
for pair in "20585885:main-branch.json" "20585889:release-tags.json"; do
  id="${pair%%:*}"; file=".github/rulesets/${pair##*:}"
  diff -u     <(jq -S '{name,target,enforcement,bypass_actors,conditions,rules}' "$file")     <(gh api "repos/musher-dev/spec/rulesets/$id"         --jq '{name,target,enforcement,bypass_actors,conditions,rules}' | jq -S .)     && echo "in step: $file" || echo "DRIFT: $file"
done
```

The live response also carries `dismissal_restriction`, which GitHub supplies
and `PUT` does not require; it is the one expected difference.

If they diverge, decide which side wins. **File wins** — reapply with the `PUT`
recipe. **Live wins** — re-export into the file and open a pull request
explaining the change. Do not leave it unresolved: a ruleset nobody can predict
from the repository is a ruleset nobody reviews.

## `release-tags.json`

Makes releases immutable:

- Applies to `refs/tags/component/**`, `refs/tags/blueprint/**`, and
  `refs/tags/listing/**`.
- **Blocks tag deletion, tag update, and any non-fast-forward move.** A
  published schema version can never be silently altered — a flaw is corrected
  by superseding it with a new patch, never by moving a tag.

Tag **creation** is deliberately unrestricted. An earlier version of this file
claimed it was limited to administrators and the release-please workflow; no
such rule existed, and the claim was worse than the gap because it described a
control a reader would then not think to add. Creation is left open because
`published.json` is the control that matters: a tag with no ledger entry fails
`task check:published` and stops the deploy, so an unauthorised tag cannot
become a published version. See
[ADR 0006](../../docs/adr/0006-publication-from-tags.md).

## Bypass

`main-branch` allows `OrganizationAdmin` bypass, matching the org-level
convention. That is an escape hatch for incident response, not a workflow — and
until 2026-08-25 it was the workflow, spent on eight consecutive merges because
the blanket approval requirement could not be satisfied by the only maintainer.
The selective gate above exists so that a bypass in the audit log is a signal
again.

**`release-tags` declared `bypass_actors: []` and the live ruleset granted
`OrganizationAdmin` bypass anyway** — the file had never been re-applied. It was
reconciled in the file's favour on 2026-08-25, which is what the paragraph below
has always claimed.

**`release-tags` allows no bypass at all.** Using a bypass there means mutating
a published artifact, which is the one thing this repository promises never
happens — and an escape hatch nobody may legitimately use is an escape hatch an
attacker inherits. An administrator who genuinely must intervene can disable
the ruleset, which is a logged, deliberate, visible act rather than a silent
one.

`published.json` remains the backstop either way: it makes a rewritten tag a
red build and a reviewable diff, which is a control that survives someone
holding the permissions to move the tag in the first place.
