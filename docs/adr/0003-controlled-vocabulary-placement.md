# ADR 0003: Where a controlled vocabulary is published

- **Status:** Accepted
- **Date:** 2026-08-17
- **Extends:** [ADR 0001](0001-canonical-repository-architecture.md) §6

## Context

Several fields across the three families take their value from a controlled
vocabulary rather than from a grammar alone. The specifications have handled
them inconsistently, because nothing said how to decide.

| Field | Today |
|---|---|
| listing `category`, `lifecycleStage` | Closed `enum` in the schema |
| blueprint `size` | A length-bounded string, and a `TODO` where the rule should be |
| blueprint `advanced` pins | Free-form strings, no prose at all |

`size` is what forced the question. It names a **Compute Profile** — a
provider-neutral machine tier — and the platform publishes both a slug grammar
and a catalog of the profiles it currently offers. Those two things have
different lifetimes. The grammar is fixed by contract. The catalog changes when
an operator enables a tier, which is neither a release of this repository nor
anything this repository can observe.

Committing the catalog here would make it a second source of truth, and the one
that is wrong: a released artifact is immutable
([GOVERNANCE.md](../../GOVERNANCE.md) §Release process), so a list frozen at
release time drifts the moment the offering changes, and a reader who trusted it
would be told a tier exists that cannot be deployed, or told one does not exist
that can.

Leaving the vocabulary unnamed is not the alternative it appears to be. It is
what the repository does today, and
[component §10](../../specifications/component/v1/spec.md#known-debt) records
the cost: a reader outside `musher-dev/platform` is shown
`general.standard.small` in three examples and has nowhere to look it up.

## Decision

### 1. Three placements, decided by what fixes the vocabulary

| The vocabulary is… | Where it lives | Example |
|---|---|---|
| Fixed by this contract | A closed `enum` in the schema | listing `category`, `lifecycleStage` |
| Grammar fixed here, membership fixed elsewhere | A `pattern` in the schema; membership named as an external publication surface and checked in the `capability` phase | blueprint `size` |
| Not fixed anywhere yet | Shape only, and the silence recorded in prose as a gap | blueprint `advanced` pins |

The test is not how large the vocabulary is or how often it changes. It is **who
decides membership**. A term this specification could add or remove by releasing
belongs in the schema. A term that becomes real when something outside this
repository is provisioned does not, however stable the list looks on any given
day.

**Rejected:** deciding by volatility. `lifecycleStage` will change rarely and
`category` may change often, but both are decided here, and a rule keyed on
expected churn would move a field between placements without anything about the
contract having changed.

### 2. A named surface, never a mirrored copy

Where membership is fixed elsewhere, the specification MUST name where the
vocabulary is published, precisely enough to fetch: a URL a reader can open
without an account. It MUST NOT restate the members, not even informatively and
not even dated.

This repository therefore does not become a vocabulary publisher, and
GOVERNANCE.md §Scope is not extended. The reasoning is ADR 0001 §6's, applied to
data rather than to code: a copy shipped from here acquires the authority of the
thing it copies, and the first time the two disagree, implementations will have
followed the one that was easier to reach rather than the one that was right.

**Rejected:** a dated, explicitly non-normative snapshot committed alongside the
prose. It reads as a convenience and behaves as a trap — a reader who finds a
list in the normative repository has already stopped looking, and the date they
were counting on to warn them is the one thing they will not check.

### 3. Membership is a `capability` failure

An externally fixed vocabulary cannot be resolved without reaching the surface
that publishes it, and
[component §7](../../specifications/component/v1/spec.md#validation-layers)
forbids the `parser`, `structural` and `semantic` phases from requiring network
access. Membership is therefore a `capability` rule: server-side, and an offline
implementation MUST NOT report it.

This is the same line
[blueprint §4.1](../../specifications/blueprint/v1/spec.md#component-reference)
already draws for a published component reference, and it costs the same thing —
the diagnostic gets no fixture, and appears in the runner's `UNCOVERED` list with
a reason.

**Rejected:** treating membership as `semantic` on the grounds that a client
could cache the vocabulary. A cache turns a rule about what the platform offers
into a rule about what a client last downloaded, and two implementations would
disagree on a valid document for reasons neither could see.

### 4. The grammar goes in the schema, and it may only grow

A vocabulary whose membership lives elsewhere still has a shape, and the shape is
this repository's to fix. Carrying it as a `pattern` is what makes a typo fail
offline instead of on a round trip to the platform.

Growing that grammar later — a new segment value, a new permitted token — admits
documents that were previously rejected, which is a relaxation and therefore a
minor release under
[component §3](../../specifications/component/v1/spec.md#compatibility).
Narrowing it is major. The asymmetry is what makes the placement safe:
[component §5.1](../../specifications/component/v1/spec.md#source) keeps its
floating-tag list *out* of the schema for the mirror-image reason, because that
list is a blocklist and growing it is a narrowing.

## Consequences

**Positive**

- `size` gets an answer, and blueprint `spec.md` loses the largest of the
  seeding-debt `TODO`s that keep v1 pre-stable.
- A reader outside the platform can resolve every value the examples show them.
- Open questions of the same shape — `category` and `lifecycleStage` governance —
  are decided by applying this test rather than re-argued per field.
- A typo in an externally-fixed vocabulary still fails offline, because the
  grammar stayed here.

**Negative**

- The specification now carries URLs it does not control. A surface that moves
  breaks a normative citation, and nothing in CI can tell.
- Placement two means a document can pass every phase this repository can run and
  still be undeployable. That is honest about where the knowledge lives, but it
  is a weaker offline guarantee than an `enum` would have given.
- Placement three — shape only — is a stated gap rather than a rule. It is the
  right record of an undecided contract, and it is still a field an author can
  write that nothing checks.

## Follow-ups

1. Apply the test to listing `category` and `lifecycleStage`, which are
   placement one today and should say so rather than being placement one by
   default.
2. Revisit blueprint's `advanced` pins when the platform publishes a vocabulary
   for them; they move from placement three to placement two at that point,
   and gain a `capability` diagnostic.
