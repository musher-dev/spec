# ADR 0004: The trust boundary around a listing description

- **Status:** Accepted
- **Date:** 2026-08-17
- **Extends:** [ADR 0001](0001-canonical-repository-architecture.md) §6

## Context

`spec.description` on a listing document is Markdown, bounded only at 20 000
characters. It is written by whoever publishes the item and rendered by the
storefront, which means it is third-party content displayed in a first-party
origin — the classic shape of a stored cross-site scripting vulnerability.

Nothing constrains it today. CommonMark permits raw HTML by design, so a
conforming listing may contain `<script>`, and
[SECURITY.md](../../SECURITY.md) already names "a schema that accepts a document
the specification forbids, where the gap has a security consequence" as a
vulnerability class in this repository.

The asymmetry in [listing §4](../../specifications/listing/v1/spec.md#presentation)
made the gap visible before this ADR did. `summary` — a 280-character tagline
that cannot hurt anyone — is constrained: it "MUST NOT be rendered as Markdown".
`description` — the field that can — is not.

The consequence of saying nothing is not that nothing is decided. It is that
every consumer decides separately, in private, and the specification learns
which of them decided wrong from a disclosure report.

Two things force the timing. First, constraining the subset rejects listings
that validate today, which
[GOVERNANCE.md § Compatibility review](../../GOVERNANCE.md) makes a breaking
change requiring a new `v<N>` directory. Second, no tag exists yet and the
`1.0.0` release PRs are still open, so the change is free now and expensive
immediately afterwards. Of the two `TODO`s this repository still carried, this
is the one where waiting has a cost that cannot be paid back.

## Decision

### 1. A named base, cited by version

`description` is **CommonMark 0.31.2**, named and versioned rather than
described as "Markdown". "Markdown" is not one language; a rule written against
it is a rule each implementation resolves against whatever parser it already
had.

Raw HTML is forbidden in CommonMark's own terms — the *HTML block* (§4.6) and
*raw HTML* inline (§6.6) constructs — rather than as a search for angle
brackets. The distinction is the whole reason for naming a grammar: a code span
and a fenced code block are different constructs in that grammar, so a listing
for a web component may document `<script>` inside a fence and remain
conforming. A rule phrased lexically would have rejected it, and the authors it
rejected would have been the ones writing honest documentation.

**Rejected:** naming a sanitiser (DOMPurify, bluemonday, sanitize-html) as the
normative reference. It is [ADR 0001](0001-canonical-repository-architecture.md)
§6's objection exactly — a reference implementation becomes the de facto
standard and hides normative behaviour inside code — with the added defect that
a sanitiser's ruleset changes on its own release schedule, not on this
repository's.

### 2. Three constructs, three rules

| Construct | Rule | Why |
|---|---|---|
| Raw HTML | Forbidden | The direct script-execution vector. |
| Link destination | `https`, `http`, `mailto`, or a fragment | `javascript:` is script execution wearing a link. |
| Image destination | An item media path per [listing §5](../../specifications/listing/v1/spec.md#media) | A remote image is a per-view beacon. |

The image rule is the one that needs its reasoning written down, because it is
the one that looks like overreach. A remote image does not execute anything. It
does disclose every storefront viewer's IP address and user agent to a host the
listing author chooses, on every page view, with no interaction — and the author
is a third party the storefront has no relationship with. Listing §5 already
fixed `media/` as the one directory an item ships assets from, for reasons that
had nothing to do with security; a description image is a media path and is held
to the same rule, so the answer is one rule rather than two.

**Rejected:** permitting remote images so that badge shields keep working. A
badge is a live third-party surface embedded in a first-party origin, which is
the thing being ruled out, and a storefront cannot cache the beacon away without
breaking the badge it was cached for.

### 3. The rule binds the renderer, not only the author

A consumer rendering `description` MUST NOT emit a construct this profile
forbids, whether or not it validated the document first.

This is the first clause in the family that constrains an implementation's
*output* rather than a document, and it is stated deliberately rather than
inherited. The grounds are that an authoring rule alone protects nobody here.
A rule about what an author MAY write is enforced by validation, and the
document this rule exists to stop is one written by someone who will not run the
validator. Every other rule in these specifications describes a document that a
careless author produces; this one describes a document that a hostile author
produces on purpose.

**Rejected:** stating the profile as an authoring rule and leaving rendering to
each consumer. It converges the *diagnostics* without converging the
*behaviour*, which leaves the injection surface exactly where it was for any
consumer that renders before validating — and rendering before validating is
what a storefront serving a cached listing does.

**Rejected:** a `sanitised: true` flag, or a field naming the renderer profile
the storefront should apply. Both make a security property of the storefront
into a value the untrusted document supplies.

### 4. One rule, two placements

`javascript:` in `homepageUrl` is the same stored XSS as `javascript:` in a
description link, and the storefront renders both. `homepageUrl`,
`sourceRepoUrl`, and `supportUrl` are bounded-length strings with no `format`
and no prose today, so the same scheme rule reaches them.

Where each half is enforced follows from what can decide it offline:

| Surface | Placement | Phase |
|---|---|---|
| The three scalar URL fields | A `pattern` in the schema | `structural` |
| Link and image destinations inside `description` | A check over the parsed document | `semantic` |

No JSON Schema pattern can decide Markdown — finding the link destinations means
parsing the document — so the description half cannot be structural. The scalar
half can be, and structural is where it belongs: every validator in every
language gets it from the bundle, offline, with no code to write.

The pattern is anchored and lookahead-free so it compiles under RE2 as well as
ECMA-262 and cannot be driven to backtrack. SECURITY.md names catastrophic
backtracking in a published pattern as a vulnerability class, and a pattern
added to close a security gap is a poor place to open one.

## Consequences

**Positive**

- The injection surface has one answer instead of one per consumer, and the
  answer is executable: three diagnostics with fixtures rather than prose.
- Listing v1 carries no `TODO`, which was the stated blocker on declaring it
  stable.
- A typo — `htps://`, a stray `javascript:` pasted from a bookmarklet — fails
  offline in the author's editor rather than on the storefront.
- The `media/` rule now means one thing across the whole document, rather than
  binding `icon` and `screenshots` while `description` did as it liked.

**Negative**

- This repository now depends on a Markdown parser to check a rule, in
  `tools/`. That is non-normative code ([ADR 0001](0001-canonical-repository-architecture.md)
  §7), so it is not contract surface, but SECURITY.md names `tools/` as a threat
  surface because it runs in CI with repository credentials. The dependency is
  the CommonMark reference implementation, pinned, and its version tracks the
  spec version cited above.
- Every implementation validating a listing must now parse Markdown. That is a
  real cost imposed on downstream SDKs, and it is imposed for the description
  half only — the scalar URL fields cost them nothing.
- The renderer clause is unenforceable by this repository. No fixture can
  observe a storefront's output, so §4.1's strongest rule is the one with no
  case behind it.
- Constraining the subset rejects listings that would have validated. Nothing is
  published yet, so the set is empty today; it is not empty in
  `musher-dev/platform`, which has no such rule.

## Follow-ups

1. The renderer clause needs a home in the conformance corpus it cannot have
   today. If the fixture contract ever grows a way to assert over rendered
   output, this is its first customer — that is an
   [ADR 0002](0002-conformance-case-trees.md)-shaped change to the case shape,
   not a fixture someone can add.
2. `tags` is an unbounded array of unbounded strings and is rendered by the
   storefront. It is plain text, so it is not this ADR's problem, but it is
   unbounded for no stated reason.
3. Neither `license` nor the item's own prose is checked against anything. The
   licence field in particular looks like an SPDX identifier and is not
   constrained to be one.
