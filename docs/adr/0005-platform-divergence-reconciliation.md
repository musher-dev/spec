# ADR 0005: Reconciling the specification against implemented platform behaviour

- **Status:** Accepted
- **Date:** 2026-08-17
- **Extends:** [ADR 0001](0001-canonical-repository-architecture.md) §1
- **Closes:** [ADR 0002](0002-conformance-case-trees.md) follow-up 2

## Context

[ADR 0002](0002-conformance-case-trees.md) closed with a follow-up naming three
points where this specification and `musher-dev/platform` deliberately disagree —
cycle detection, parameter-merge conflicts, and whether a `SERVICE` must expose an
endpoint — to be reconciled before v1 is declared stable. ADRs are immutable, so
that follow-up is discharged here rather than edited there.

Each is a live divergence rather than an unfilled gap: an implementation conforming
to this repository and the platform as it stands today return different verdicts on
the same document. All three arrived together, in the pass that filled the `spec.md`
`TODO` markers from implemented behaviour, and in each case the specification decided
against the implementation with its reasoning recorded in the prose.

[ADR 0001](0001-canonical-repository-architecture.md) §1 is the grounds each one
cited: *"Where an implementation and the conformance suite disagree, the
implementation is defective."* That rule is not in question. But it decides **who
changes**, not **whether the specification chose correctly**, and a rule invoked to
settle three disagreements in a single pass deserves to be tested against each of
them separately before the contract is published and the answers become expensive.

A fourth question is settled in the same pass. Component §5.2 records that v1 gives
the contract no way to read the edge address of a `PUBLIC` `TCP` or `UDP` endpoint,
"a question this version declines to answer rather than one it overlooked". The
platform ships that capability today, so a component whose sibling needs a broker's
or a database's edge address at install time cannot express it. Declining to answer
was reasonable while the question was new; leaving it unanswered through publication
is not.

### Why now

The timing is not incidental — it is the whole reason this ADR exists at this
moment rather than later.

`git tag -l` is empty, `.github/release-please/manifest.json` reads `0.0.0` for all
three families, and the three `1.0.0` release pull requests are still open. Two of
the four decisions below reject documents that validate today, which
[GOVERNANCE.md § Compatibility review](../../GOVERNANCE.md) makes a breaking change
requiring a new `v<N>` directory and a migration note.

## Decision

### 1. The pre-publication window, and what closes it

**While no version of a family has been published, a change to that family that
would reject a previously valid document does not require a new major directory.**

Component §3 guarantees that a document validating against `v1.0.0` also validates
against every later `v1.x.y`. The guarantee is stated against a released version, and
where no such version exists there is no document anywhere that was validated against
a published v1 and would now fail. A migration note would have nothing to migrate
from, and a `v2` directory would be the second major of a specification whose first
was never served.

The window is narrow and its closing condition is exact: **it closes for a family the
moment that family's first tag is created.** After that, every rule below that
narrows validation is a `v2` change on the ordinary terms, with no discretion left in
it.

This is written down because it has already been relied upon twice — the endpoint,
environment-variable and graph-rule tightenings each landed on this reasoning — and
because a rule that decides whether a change is free or costs a major version should
be citable rather than reconstructed from pull request descriptions.

Nothing here weakens GOVERNANCE.md. Breaking changes still need maintainer approval
and still must be declared as breaking in the commit trailer; what the window removes
is only the `v<N>` directory and the migration note, and only while there is nothing
to migrate.

### 2. Cycle detection: the platform is right, and the rule is withdrawn

**The connection graph MAY contain a cycle.** `ERR_DEPENDENCY_CYCLE` is withdrawn.

Blueprint §4.2 required acyclicity while conceding, in the same clause, that
"acyclicity is not a resolution hazard". That concession is load-bearing and it is
correct. [Component §6.2](../../specifications/component/v1/spec.md#outputs) makes an
output a function of its own node and nothing else — an invariant this contract
states normatively, carries a diagnostic for, and is not going to withdraw. Every
output in a graph is therefore resolvable before any edge is bound, so a resolver
needs no topological order and does not diverge on a cycle.

The rule was held anyway on three arguments, and each is weaker than it looked:

- *It obliges every implementation to be a two-pass resolver in perpetuity.* It does
  not oblige anything. The two-pass shape is a **consequence** of component §6.2, not
  a burden acyclicity would have lifted — an implementation that resolves outputs
  before binding edges is doing what the contract already describes, and one that
  interleaves them is reading a rule that was never written.
- *It forecloses any later rule that needs an order.* This is real, and it is what is
  being given up. See Consequences.
- *It obliges every reader to work out whether a six-node graph terminates.* Nothing
  in a blueprint graph fails to terminate. Resolution is a single pass over a finite
  node set, and the question the reader is being asked to answer does not arise.

Against those stands a capability with a name and a live consumer: **mutual service
discovery**, two services that each need the other's address. The acyclicity rule
made it inexpressible, and it is the platform's recorded reason for permitting cycles
in the first place. A specification that spends a working capability to hold options
open for rules nobody has proposed is paying now for later.

ADR 0001 §1 still decides who changes when the two disagree. It is simply not a
reason to keep a rule that does not earn its cost.

### 3. Parameter-merge conflicts: the specification is right, and the rule stands

**A conflicting input redeclaration remains `ERR_CONFLICTING_INPUT_SCHEMA`.**

The platform's `merge_user_inputs` takes the first declaration of a repeated key and
discards a differing second one in silence. Blueprint §5.2 rejects the composition
instead, and that reasoning is unchanged by this ADR: silent first-wins settles the
ambiguity without telling anyone there was one, and hands the second component a
value validated against the first component's rules — a bare `STRING` where it
required an enum member, a 64-byte secret where its pattern allowed 32. Nothing fails
at validation time. It fails at deploy time, inside the consuming workload, a long
way from the two documents that disagreed.

This is the one divergence the reconciliation leaves standing, and ADR 0001 §1
resolves it without further ceremony: the implementation is defective. The merge
**order** changes with it — `(ordering, componentId)` names two fields this contract
does not have, and lexicographic node name is the only total order a document itself
supplies.

### 4. A `SERVICE` MUST declare at least one endpoint

**The platform's rule is adopted.** `spec.workload.endpoints` is REQUIRED and
non-empty where `kind` is `SERVICE`.

This is the divergence that ran the other way. Every other disagreement in this ADR
has the specification rejecting a document the platform accepts, where an author
following the contract is safe and the implementation is the thing that must catch
up. Here the specification was **looser**: it called a document valid that the
platform will not deploy, so an author who followed it exactly was led into a
deploy-time failure with a conformant document in hand. That is the one direction a
contract must not be wrong in.

Permitting an endpointless `SERVICE` also left `kind` carrying no information. §5
already concedes that such a workload and a `WORKER` "are operationally much the same
thing"; a discriminator whose branches describe the same thing is not discriminating.

The rule was declined originally because adopting it invalidates
`examples/minimal.yaml` and the `structural-001-minimal-valid` fixture. That is a
cost in fixtures, not in contract quality, and §1 above is why it is affordable now
and not later.

### 5. The edge address is exposed, by two new sources

`platformDefault.source` gains **`PUBLIC_ADDRESS`** — the full `host:port` — and
**`PUBLIC_PORT`**, the allocated edge port alone. Both are additive: no document that
validates today names either.

Two sources rather than one because a consumer that takes host and port as separate
settings should not have to split a string that this contract composed. The pairing
with §5.2's two address forms is exact and exclusive: `PUBLIC_URL` and
`PUBLIC_HOSTNAME` require an HTTP-family endpoint, `PUBLIC_ADDRESS` and `PUBLIC_PORT`
require a `TCP` or `UDP` one, and naming the wrong family is `ERR_ENDPOINT_NOT_HTTP`
or the new `ERR_ENDPOINT_NOT_L4`.

An HTTP-family endpoint is reachable at a host and a port too, and admitting it here
was rejected deliberately. It is published through the shared ingress rather than an
allocated edge port, so what a `host:port` derivation would yield is the ingress
address on port 443 — a true statement about where the endpoint answers, and not the
thing an author asking for an edge address is asking for. A source that returns a
defensible value nobody wanted is worse than one that rejects the document.

The alternative shape issue #32 raised — a `self.publicAddress.<endpoint>` reference
namespace — is rejected. This contract has no expression language; references are
structural fields, and introducing a namespace to answer one question would be a far
larger change than the question warrants.

### 6. No deviation register is created

Issue #24 names "this repository records an accepted deviation" as one of three ways
each divergence could close. No such mechanism exists in GOVERNANCE.md or in these
ADRs, and none is created here.

After the four decisions above, the only surviving disagreement is §3, where ADR 0001
§1 already supplies the answer and the platform has a defect to fix. A register would
be a place to record permanent, blessed non-conformance, and a specification that
maintains one has conceded that its conformance suite is advisory. The absence is the
position, and it is recorded here so that a reader who goes looking for the register
issue #24 assumed finds this paragraph instead of a gap.

## Consequences

**A later rule that needs an order is now breaking.** This is the real price of §2.
An ordered rollout, a health-gated start, or a value that legitimately depends on an
inbound edge would each need an acyclic graph, and re-introducing that requirement
after publication rejects compositions v1 accepts. Anyone proposing such a rule is
proposing a major version, and should know that before starting.

**Two implementations of the platform's behaviour must change**, in opposite
directions. `merge_user_inputs` gains a conflict check and a new sort key; the
composition path loses nothing, because permitting cycles is what it already does.

**Documents are rejected that validate today.** An endpointless `SERVICE` is the only
new rejection, and it is confined to the component family. Everything else in this
ADR either loosens validation or adds vocabulary no existing document uses.

**The conformance corpus absorbs the `SERVICE` change unevenly.** A case that already
fails at or before the `structural` phase is unaffected, because the runner matches
declared diagnostics as a subset. A passing case, a `semantic`-phase case, or a
component document reached through a cross-family tree must declare an endpoint or it
breaks — including `semantic-007`, whose entire premise was a probe on an endpointless
`SERVICE` and which is re-based onto a `WORKER`.

**The window in §1 is spent.** These are the last free tightenings. The release pull
requests should merge after this lands, and every narrowing proposed afterwards is a
`v2` directory.

## Follow-ups

1. File the two platform defects this ADR leaves open: the merge conflict check and
   the merge sort key.
2. Component §10's remaining debt is untouched — schema `description` fields that
   still speak the platform's vocabulary. It is a wording gap, not a divergence.
