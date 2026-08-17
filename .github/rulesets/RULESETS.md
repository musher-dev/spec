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
- **Required status checks**: `Lint`, `Schema`, `Site Build`, `Signed off`.
  `Schema` is the one that matters most — it carries the bundle drift gate.
  `Site Build` carries the publication-ledger gates. `Signed off` is the DCO
  check CONTRIBUTING.md requires.
- **Deletion and force-push blocked.**

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
convention. That is an escape hatch for incident response, not a workflow.

**`release-tags` allows no bypass at all.** Using a bypass there means mutating
a published artifact, which is the one thing this repository promises never
happens — and an escape hatch nobody may legitimately use is an escape hatch an
attacker inherits. An administrator who genuinely must intervene can disable
the ruleset, which is a logged, deliberate, visible act rather than a silent
one.

`published.json` remains the backstop either way: it makes a rewritten tag a
red build and a reviewable diff, which is a control that survives someone
holding the permissions to move the tag in the first place.
