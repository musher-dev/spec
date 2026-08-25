# ADR 0016: Dependency updates arrive as signed, conventional commits

- **Status:** Accepted
- **Date:** 2026-08-25
- **Refines:** [ADR 0015](0015-selective-code-owner-review.md)

## Context

Dependabot has opened five pull requests against this repository. Three were
closed unmerged. The two that were still open when this was written — #60,
bumping a dev container Feature, and #61, bumping four tools — had sat for three
days, red on the same two checks, and would have sat indefinitely.

Neither failure was about the dependency. `Lint`, `Schema`, `Site Build` and the
whole Dev Container workflow passed on both. What rejected them was this
repository's own CI contract, in two independent ways.

**The DCO check rejected a sign-off that was there.** Dependabot signs its
commits. It authors them as one identity and signs them as another:

```
author:  dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
trailer: Signed-off-by: dependabot[bot] <support@github.com>
```

`.github/workflows/dco.yml` matched the trailer against `%an <%ae>` exactly, so
the mismatched address failed it. `Signed off` is a required status check in
`.github/rulesets/main-branch.json`, which left every dependency update in this
repository mergeable only by spending the `OrganizationAdmin` bypass — the exact
habit [ADR 0015](0015-selective-code-owner-review.md) was written to end,
recreated for a class of change nobody would think to look at.

**The title check rejected a prefix the configuration could never have got
right.** `.github/dependabot.yml` set `prefix: 'devcontainer'`. Dependabot emits
the prefix as the Conventional Commits *type*, and `devcontainer` is a *scope*
in `.github/conventional-commits.yaml`. Every dev container update since that
line was written opened with a title no gate would accept. Nothing said so,
because `task check:commits` reconciled three copies of the vocabulary and
`dependabot.yml` was a fourth it did not read. CONTRIBUTING.md was a fifth, and
had already drifted — it was missing `deps-dev`.

Separately, Dependabot capitalises the subject it writes (`Bump …`), which
`subjectPattern` in `lint-pr.yml` rejects. That capital is not configurable:
dependabot-core decides it from a heuristic over recent commit messages, and on
this repository it lands on "capitalise" against a history that is entirely
lowercase — 4 bot pull requests out of 4.

## Decision

### 1. A GitHub App's sign-off is matched on name, not address

The DCO certifies provenance by a legal person. For a GitHub App that person is
its operator, not the app, and the operator signs under its own address — an
address the commit author field is not theirs to set, any more than the noreply
author address is theirs to sign under. The two can never match, so requiring
that they match does not test provenance; it tests a coincidence.

`dco.yml` keeps the exact `Name <email>` match for everyone and adds one branch:
when *both* halves of the author identity say GitHub App — `%an` ends in
`[bot]` **and** `%ae` ends in `[bot]@users.noreply.github.com` — a
`Signed-off-by` trailer naming that same author is accepted whatever its
address. A real trailer is still required, the name must still match, and a
commit that is a bot in only one half of its identity is still rejected.

This widens nothing that mattered. The check is a paper trail, not a security
control: anyone willing to forge a bot's sign-off could already author under a
bot's address, or simply type the trailer.

### 2. A dependency update is `build(deps)`, `build(deps-dev)`, or `ci(deps)`

`prefix` values in `.github/dependabot.yml` are types, and `include: 'scope'`
appends `deps` or `deps-dev` according to the dependency's own kind. That gives
the dev container and `tools/` ecosystems `build(…)` and the actions ecosystem
`ci(…)`.

It is the vocabulary this repository already reached for: the one dependency
bump in its history is `build(deps): bump the tooling group, dropping
ajv-formats`. It also puts the `deps` and `deps-dev` scopes to work, which have
been in `conventional-commits.yaml` since the beginning with nothing producing
them. `build`, `ci` and `chore` are all `hidden: true` in
`.github/release-please/config.json`, so no dependency bump can cut a
specification release whichever of them is used.

### 3. The capitalised subject is corrected, not excused

The first step of the `Conventional PR title` job in
`.github/workflows/lint-pr.yml` lowercases the first letter of the subject on a
Dependabot pull request. The action then judges the corrected title like any
other. The rule stays single: there is no author exempt from it, and nothing
lands on `main` reading `Bump`.

**It has to be the same job, not a workflow of its own.** That was tried first,
and it does not hold: a retitle made with `GITHUB_TOKEN` does not trigger a new
workflow run — GitHub suppresses that to prevent loops — so the title check sits
on the red it produced *before* the edit, with a title that is now correct, until
some unrelated event happens to re-run it. On #66 that red simply stayed. On #60
it cleared, but only because Dependabot pushed again a minute later, which is
luck rather than design.

Correcting the title in the step before the check closes the race, and it works
because `amannn/action-semantic-pull-request` re-reads the title from the REST
API rather than trusting the event payload — deliberately, for exactly this
reason. Confirmed empirically: re-running the stale failed run on #66, with its
original payload, passed.

The job runs on `pull_request_target`, so it holds a write token while running
from the base branch. Three properties keep that safe, and are stated in the
file so they survive editing: it never checks out the head (there is no checkout
step), values from the pull request reach the shell through `env:` rather than a
`${{ }}` expansion inside `run:`, and it rewrites case only, after a
conventional-*shaped* prefix. Whether the type and scope in that prefix are real
remains the check's business; correcting them here would paper over exactly the
`dependabot.yml` bug described above.

### 4. Every copy of the vocabulary is checked, including the bot's

`tools/src/commits.ts` now reads `.github/dependabot.yml` and
`.github/CONTRIBUTING.md` alongside the three files it already reconciled. A
prefix must parse as `<type>` or `<type>(<scope>)` and name a type and scope the
source of truth lists; `include: 'scope'` requires `deps` and `deps-dev` to
exist. When the type it finds is a valid *scope*, the failure says so — that
being the mistake actually made.

A `commits` job in `.config/lefthook.yml` runs the check before the push as well
as in CI. The prefixes in `dependabot.yml` are exercised once a week by a bot
nobody watches, which is the longest possible feedback loop for a typo.

### 5. `wrangler` is excluded from the grouped update

GOVERNANCE.md → Tooling dependencies names `wrangler` as the only dependency
here handed a credential, and rests its guarantee on that exact pin moving "only
through a diff someone opened deliberately". Grouped with everything else under
`patterns: ['*']`, it would move inside four other packages' lockfile churn — a
diff someone opened, but not one opened *for it*. `exclude-patterns` keeps it
out, so it always arrives as its own reviewable pull request.

## Alternatives considered

**Exempt bot pull requests from the title check** — `ignoreLabels: dependencies`
is the semantic-pull-request action's own escape hatch, and it is one line
against a workflow. Rejected: it stops validating the type and scope as well as
the case, so the `devcontainer:` bug would still have been invisible, and it
leaves `Bump` in `git log` on `main` permanently. A rule with one author exempt
is a weaker thing to maintain than a rule with none.

**Relax `subjectPattern` for everyone** — retires a repository-wide convention
to accommodate a bot, and takes the guard away from humans too.

**A separate normaliser workflow** — cleaner to read, and broken for the reason
in decision 3: nothing re-runs the check it invalidates.

**Exempt bot commits from the DCO check entirely** — simpler than matching on
name, and wrong: Dependabot's sign-off is real and there is no reason to stop
reading it. Skipping the check would also skip it for any future app whose
sign-off is genuinely absent.

**Add `/.github/dependabot.yml` to CODEOWNERS** — would gate the configuration
on a review. Rejected as inconsistent with GOVERNANCE.md's deliberate argument
that `tools/` is not gated on a review, and that the pin plus the lockfile
carries the guarantee;
the `check:commits` guard is the control that fits that argument.

**Split major bumps out of the `tooling` group** — #61 carries `cspell` 9 → 10
in a grouped diff and CI passes on it, so the group is doing its job. Worth
revisiting the first time a major lands broken, not before.

## Consequences

Dependency updates merge on green CI without a bypass. They are correctly typed
and scoped, so they read as maintenance in `git log` and cannot cut a release.
The vocabulary now has five copies and a check that holds all five, rather than
three copies and two that drifted unobserved. `wrangler` moves only in a pull
request opened for it.

The normalisation step is not a gate; the action in the same job is. Because
they share a run, a Dependabot pull request goes green on its first attempt
rather than showing a transient red that something else has to clear.

## Follow-ups

- #60 and #61 are recreated rather than force-fixed, so they come back carrying
  the corrected prefixes.
