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

- **Pull request required**, one approving review, **code-owner review
  required**. Every change here alters a public contract; CODEOWNERS review is
  the compatibility gate described in GOVERNANCE.md.
- **Stale reviews dismissed on push**, so an approval cannot survive a rewrite.
- **Linear history**, squash-merge only. The specification's history should read
  as a sequence of deliberate changes.
- **Required status checks**: `Lint`, `Schema`, `Site Build`. `Schema` is the
  one that matters most — it carries the bundle drift gate.
- **Deletion and force-push blocked.**

## `release-tags.json`

Makes releases immutable:

- Applies to `refs/tags/component/**`, `refs/tags/blueprint/**`, and
  `refs/tags/listing/**`.
- **Blocks tag deletion and any non-fast-forward update.** A published schema
  version can never be silently altered — a flaw is corrected by superseding it
  with a new patch, never by moving a tag.
- Tag creation is restricted to repository administrators and the
  release-please workflow.

## Bypass

Both rulesets allow `OrganizationAdmin` bypass, matching the org-level
convention. That is an escape hatch for incident response, not a workflow.
Using it on `release-tags` means mutating a published artifact — do not.
