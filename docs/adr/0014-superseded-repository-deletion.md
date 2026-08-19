# ADR 0014: The superseded repository is deleted, not archived

- **Status:** Accepted
- **Date:** 2026-08-19
- **Supersedes:** [ADR 0012](0012-cloudflare-pages-publication.md) §5
- **Closes:** [ADR 0012](0012-cloudflare-pages-publication.md) follow-up 2

## Context

[ADR 0001](0001-canonical-repository-architecture.md) §1 said `musher-dev/specs`
"is superseded and will be deleted". [ADR 0012](0012-cloudflare-pages-publication.md)
§5 archived it instead, eleven days later, and gave a good reason: deletion
`404`s every inbound reference, including ADR 0001's own account of why this
repository exists.

What has changed since is that the harm §5 weighed against that cost has stopped
being anticipated and become live. `schemas.musher.dev` now resolves.
`musher-dev/infra#336` created the `musher-schemas` Pages project, attached the
custom domain, and added the proxied `CNAME`; this repository's deploy is the
only thing still outstanding. The archived repository's README advertises URLs
on that hostname for a `bundle-definition` schema — the agent-bundle format the
platform no longer ships. Those URLs never served anything. They now name a
hostname that serves *this* repository's contract instead, so a reader following
one does not land on nothing; they land on a different contract than the page
that sent them there described.

An archive banner does not fix that. It says the repository is read-only. It
does not say the concept was retired, and it says nothing at all about who owns
the URLs underneath.

Archiving also left the retirement half-finished in a way no change to this
repository could complete. `specs` is still named in the organisation's
`pr-workflow` ruleset (`14207433`) while `spec` is not — a pull-request rule
guarding a repository that accepts no pull requests.

## Decision

### 1. `musher-dev/specs` is deleted

This restores ADR 0001 §1 as written. It is not renamed and not transferred: its
only content described a retired concept, in one commit, with no CI, no licence
and no runner.

### 2. The cost is paid rather than argued away

ADR 0012 §5's objection was correct and is not withdrawn here. Deleting the
repository breaks every link to it, and this repository holds four of them —
ADR 0001's header, its Context, its §1, and ADR 0012 §5 itself. None is
rewritten. An accepted ADR is a record of what was decided and why, and editing
one to hide a dead link would cost more than the dead link does.

What makes the loss bearable is that no link to that repository was ever
load-bearing. ADR 0001's Context describes what was there — a
`bundle-definition` JSON Schema, one commit, no CI, no licence, no runner, and
`schemas.musher.dev` URLs that were never served — in enough detail that the
supersession stays legible from this repository alone. A reader who follows the
link and gets a `404` has already been told what they would have found.

The history itself is not preserved anywhere else, and that is a genuine loss
rather than a mitigated one. If a mirror is wanted it has to be taken before the
deletion, because afterwards there is nothing left to clone. This decision does
not depend on one being taken.

### 3. The organisation ruleset no longer names it

Dropping `specs` from `pr-workflow` (`14207433`) is the last sentence of ADR 0012
§5 and its follow-up 2. The other six repositories in that ruleset, and every
rule, bypass actor and ref condition on it, are untouched.

`spec` is deliberately **not** added in its place. This repository self-manages
`.github/rulesets/main-branch.json`, which is strictly stronger — pull request
plus code-owner review, linear history, four required status checks, squash-only.
GitHub aggregates rulesets most-restrictive-wins, so naming this repository at
the organisation level would buy nothing, and the organisation rule's blanket
`required_approving_review_count: 1` would sit *beside* the repository's
selective code-owner gate rather than above it — the same trap that got
`platform` removed from that ruleset.

## Alternatives considered

**Keep it archived, as ADR 0012 §5 decided.** The position this ADR reverses.
Archiving is the better end state for a repository whose history explains
something, and worse for one whose public face misdescribes a hostname now in
use. `musher-dev/specs` is the second kind: a single commit of a retired schema.
There is no history there to keep legible.

**Unarchive, rewrite the README to point here, re-archive.** Three state changes
to a retired thing, and the result is a public repository whose only remaining
purpose is to say it has no purpose. It also leaves the name occupied, which
matters more than it looks: `specs` and `spec` differ by one character, and
keeping both live is a standing invitation to open a pull request against the
wrong one.

**Rename it to something visibly dead.** GitHub redirects the old path after a
rename, which is the one thing here that would preserve the inbound links. It
also preserves the repository, its README, and the wrong `schemas.musher.dev`
URLs in it, redirected to a new name and still public. That trades the whole
point of the retirement for the links.

## Consequences

**Positive**

- No public Musher repository advertises `schemas.musher.dev` URLs it does not
  serve, from the moment that hostname starts serving.
- The `pr-workflow` ruleset describes repositories that exist.
- ADR 0001 §1 is once again an accurate statement of what happened.

**Negative**

- Four links in this repository's ADRs now `404`, and stay that way.
- The commit history of the superseded repository is gone unless a mirror was
  taken first.
- Any external bookmark, fork or clone reference to `musher-dev/specs` breaks
  without a redirect. Nothing known depends on one; that is not the same as
  nothing depending on one.

## Follow-ups

This ADR opens none. [ADR 0012](0012-cloudflare-pages-publication.md)
follow-ups 1 and 3 remain open and are untouched here.
