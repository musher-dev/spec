# ADR 0015: Review is a code-owner gate, not a blanket approval

- **Status:** Accepted
- **Date:** 2026-08-25
- **Refines:** [ADR 0001](0001-canonical-repository-architecture.md)

## Context

Until this decision the `main-branch` ruleset required one approving review on
every pull request, and `.github/CODEOWNERS` opened with a `*` catch-all naming
the repository's single maintainer. Together those two settings said: nothing
merges here without `@justinmerrell`'s approval.

That is not what happened. `@justinmerrell` is the only owner, GitHub cannot
request a review from a pull request's author, and the ruleset grants
`OrganizationAdmin` an always-bypass. So every pull request they opened arrived at
the merge box blocked, and every one was merged by spending the bypass. Eight
consecutive merges to `main` — #42, #45, #47, #48, #52, #53, #55, #57 — carry
`reviewDecision: REVIEW_REQUIRED`. The gate was not satisfied on any of them. It
was stepped over on all of them.

A control exercised only by bypassing it is worse than no control, for the
reason `.github/rulesets/RULESETS.md` already gives about tag creation: it
describes a protection a reader will then not think to add. It also trains the
one person who can disable the ruleset entirely to treat the bypass as a normal
step, which is precisely the habit that makes an admin account worth stealing.

Meanwhile the requirement's real cost fell on everyone else. A contributor
fixing a typo in the dev container waited on the same approval as someone
narrowing an enum in a published schema, and the maintainer's attention was
spent equally on both. Review that is demanded everywhere is review that is
skimmed everywhere.

`musher-dev/platform` reached the same conclusion and solved it, and it is worth
adopting the same mechanism rather than a third variant: a contributor moving
between the two repositories should not have to relearn when review is required.

## Decision

### 1. Review is required per changed file, not per pull request

`.github/rulesets/main-branch.json` pairs two parameters:

```json
"required_approving_review_count": 0,
"require_code_owner_review": true
```

A count of `0` is GitHub's sanctioned "no blanket reviewers" value; the
code-owner requirement is evaluated against each file the pull request touches.
Together they mean a pull request that touches no path in `.github/CODEOWNERS`
merges on green CI alone, and a pull request that touches an owned path
additionally needs that path's owner to approve, with every review thread
resolved.

Review stops being a toll on all changes and becomes a guarantee about specific
ones.

### 2. The owned set is the gate itself, and nothing else

```
/.github/CODEOWNERS      @justinmerrell
/.github/rulesets/       @justinmerrell
```

These two paths *are* the control. Leaving them unowned would let a single pull
request quietly widen or remove the gate, so they are protected the way GitHub
recommends protecting CODEOWNERS: with CODEOWNERS.

Everything else — including `specifications/` and `conformance/`, which carry
the normative contract — is unowned and merges on green CI. That is the part of
this decision that deserves to be uncomfortable, and §4 addresses it.

### 3. Both halves are mechanically kept in step

Either half is silently useless without the other, and both failure modes look
like tightening: add a `*` catch-all and every pull request is owned again; set
the count back to `1` and every pull request is blocked again. Neither change
produces an error.

`tools/src/rulesets.ts`, run by `task check:rulesets` inside the existing `Lint`
job, enforces RUL-01..RUL-09 — the ruleset shape, the `0` + `require_code_owner_review`
pairing, `require_last_push_approval: false`, the absence of a catch-all, owner
syntax, and that every root-anchored CODEOWNERS pattern resolves to a real path.

RUL-09 goes beyond platform's version, which documents the rule and enforces
nothing: every required status check must name a job that some workflow actually
publishes, and that workflow must not filter on `paths:`. Both mistakes produce
the same outcome — a required context that never reports, and a pull request
that hangs forever. It is also why this check runs inside `Lint` rather than as
its own workflow: a path-filtered validator would be the bug it exists to catch.

### 4. Compatibility review survives as an obligation, not a gate

GOVERNANCE.md still requires maintainer approval for a breaking change to a
published contract. Under §2 nothing mechanically enforces that on
`specifications/`.

This is stated plainly rather than papered over. The trade is deliberate: the
mechanical gate on those paths was never actually satisfied, so removing it
gives up an enforcement that existed only on paper, while the checks that *did*
run — `check:drift`, `check:compat`, `check:published`, the conformance suite —
are unaffected and remain required. Those catch the specific failure a
compatibility review is looking for far more reliably than an approval click
does.

### 5. A self-owned edit is announced

GitHub waives the code-owner requirement for a pull request's own author. With a
single owner on both governance paths, that means the person able to change the
gate is the person it never stops.

`.github/workflows/codeowners-notice.yml` posts and maintains one sticky comment
listing the paths in a pull request that its own author owns. It is a notifier,
not a gate: it blocks nothing and is deliberately absent from the required
checks. It converts a silent waiver into a visible one.

## Alternatives considered

**Keep the blanket approval and stop bypassing it.** This is the honest version
of the status quo, and it does not work with one maintainer: nobody can
approve their own pull request, so the repository would be unable to accept its
own maintainer's changes at all.

**Own the normative surface too** (`/specifications/`, `/conformance/`,
`/docs/adr/`). Tempting, and it would keep GOVERNANCE.md's compatibility-review
promise mechanical. Rejected because with a single owner it reproduces the
original failure exactly: that maintainer's own contract changes would still be
waived by authorship, and everyone else's would still be blocked on one person. It buys a
gate that binds only the contributors it was not written for. When there is a
second maintainer this is the first thing to revisit.

**Require two approvals with a bot bypass for automation.** More machinery, a
dedicated GitHub App to provision, and still no answer to the one-maintainer
problem.

## Consequences

- A pull request touching only `tools/`, `.devcontainer/`, `.config/`, prose, or
  the specifications merges on green CI. The required checks — `Lint`, `Schema`,
  `Site Build`, `Signed off` — become the real gate, and their coverage now
  matters more than it did.
- Changing the gate still requires review, from the owner of the two paths that
  define it.
- The `OrganizationAdmin` bypass stops being part of the daily workflow and goes
  back to being an incident-response escape hatch. A bypass in the audit log is
  once again a signal.
- GOVERNANCE.md's approval requirements are now social where they were
  advertised as mechanical, and say so.
- A second maintainer changes the calculus: at that point owning
  `specifications/` and `conformance/` costs nothing and buys back the
  compatibility gate. Revisit then, not before.

## Follow-ups

- Live ruleset state is still applied by hand, per `.github/rulesets/RULESETS.md`.
  The default `GITHUB_TOKEN` cannot read rulesets, so drift detection needs an
  operator with a PAT; `task check:rulesets` validates the committed files but
  cannot see GitHub.
- `Conventional PR title` (from `lint-pr.yml`) is not a required check. Platform
  requires its equivalent. It is a candidate for the required set once its
  `pull_request_target` trigger has been reviewed for the token exposure that
  trigger implies.
