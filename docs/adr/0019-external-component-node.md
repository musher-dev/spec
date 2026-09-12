# ADR 0019: A node this platform does not run

- **Status:** Accepted
- **Date:** 2026-09-11
- **Extends:** [ADR 0009](0009-resource-type-registry.md)
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

A component is a workload. `ComponentSpec` requires `workload`,
`ComponentWorkload` requires `kind` and `source`, and `source` is a strict
`oneOf` of a pinned image or a git build. There is no way to write a component
that this platform does not run, and no way for a blueprint to name one.

That is a gap with a measured consequence. `musher-dev/catalog` publishes
thirteen curated items, and four of them — `openclaw`, `open-webui`, `flowise`,
`langflow` — cannot function without a language model the platform does not
host. The catalog documents the hole itself: `open-webui` declares an input
`ollamaBaseUrl` whose default is `http://ollama:11434`, and whose description
reads

> The default points at a sibling `ollama` service that is **NOT part of this
> deployment**; replace it with your own endpoint when enabling.

A default that names a service the deployment does not contain is an author
working around a missing primitive. What the item wants to say is that it
consumes something addressed elsewhere, that the address and the credential are
the deploying user's to supply, and that the two arrive together.

### What the graph already does, and the one thing it cannot

[Component §6](../../specifications/component/v1/spec.md#contract) already
models what a node consumes and publishes, and
[blueprint §4.2](../../specifications/blueprint/v1/spec.md#connections) already
wires one node's output into another node's input, consumer-anchored, one wire
per input. A composition of a thing-we-run and a thing-we-do-not is a graph of
two nodes and three wires, and every part of that is expressible today except
the second node.

So this is not a new composition model. It is one missing node shape.

### Why the values have to arrive together

A service addressed elsewhere is reached with a set of values, not one: an
address, a credential, and usually a name selecting what answers. Those values
are only meaningful *as a set* — an address from one provider beside a
credential from another reaches nothing.

That is the constraint that decides the shape of this ADR. Three independently
declared inputs, each tagged with its own
[`resourceType`](0009-resource-type-registry.md), can each be satisfied
correctly and still not agree with one another, and nothing in the contract
would notice. A node is what makes the set structural: the values belong to one
node because a node is one thing, and a consumer wiring two of them from the
same `fromRole` is wiring them from one source by construction.

It is also why this is not the grouping
[ADR 0018](0018-install-form-presentation.md) §3 declined. That section rejected
a declared `group` because a group name is a claim about a form that will also
hold *other components'* inputs, which the declaring document cannot see. A node
is not a name — it is a local identity the blueprint can see, and two nodes'
inputs never merge — so §3's objection does not reach it, and §3 is not
reopened.

### Why now

`git tag -l` is empty, `published.json` records no release, and the three
`1.0.0` release pull requests are still open, so
[ADR 0005](0005-platform-divergence-reconciliation.md) §1's window is open for
every family. One decision below narrows what validates and is free only inside
it. The rest are additive and would keep.

## Decision

### 1. A component declares either a `workload` or an `external` block

`ComponentSpec` stops requiring `workload` and requires exactly one of
`workload` and `external`. Which key is present is the discriminator; there is
no tag.

```yaml
spec:
  external:
    resourceType: dev.musher.llm.chat-completions
  contract:
    inputs: { … }
    outputs: { … }
```

`contract` is already a sibling of `workload`, so an external component gets
inputs and outputs with no restructuring, and the block itself carries only what
[§5](#5-resourcetype-is-read-at-node-scope-and-a-url-is-not-sniffed) needs.

**Rejected: `spec.remote`.** `remote` is spent twice. CLAUDE.md's second
non-negotiable uses it for a `$ref` that leaves the bundle, and
[listing §5](../../specifications/listing/v1/spec.md#media) for a URL outside
the item. Both mean *the bytes are somewhere else*; this block means *this
platform does not run it*. It is also an adjective about location, and a
workload in another region is remote and is still ours.

**Rejected: `spec.resource`.** [ADR 0007](0007-naming-conventions.md) §3 spends
a section resolving the collision between a document envelope and the platform's
resource envelope, and a document-level `spec.resource` reintroduces exactly
that hazard. `resource.resourceType` also reads as a stutter and implies the
node tag and the value tag are the same claim, which §5 shows they are not.

**Rejected: a `spec`-level `type` tag.** It would be a REQUIRED field on every
document ever written, which is the largest narrowing available here bought for
nothing the key-presence form does not already give. And spelling the union as a
`oneOf` at `spec` puts every `default` beneath it out of reach of
`tools/src/effective.ts`, which resolves `$ref`, `allOf` and the nullable
`anyOf` idiom and reports anything else unresolvable —
[ADR 0018](0018-install-form-presentation.md) §5 rejected a union on that exact
ground.

**Rejected: a fifth `workload.kind`.** An `EXTERNAL` runtime shape would have to
forbid `source`, `endpoints`, `command`, `schedule`, `volumes`, `health` and
`envVars` — seven of the eight properties `ComponentWorkload` declares, leaving
only the discriminator. Every existing branch in that block *adds* a constraint
to a kind; this one would subtract the block's own `required: ["source"]`,
making `source` "required except on one kind", which is the inverse shape. And
[component §5](../../specifications/component/v1/spec.md#workload) opens by
saying `spec.workload` is how the component runs, which a kind that runs nothing
falsifies in the section's first sentence.

**Why `external` is available.** It appears four times across the three
specifications and every one is the adverb "externally reachable", describing a
`PUBLIC` endpoint. It collides with nothing.

The precedent worth naming is Kubernetes' `Service` with
`type: ExternalName`: the same kind as an in-cluster service, in a shape that
says it lives elsewhere. Radius makes the same move with
`resourceProvisioning: 'manual'`, and the Kubernetes Service Binding
specification makes the companion one — a binding is **one** object carrying a
set of well-known entries, never a set of independent fields.

### 2. An external component publishes at least one output, and no `DERIVED` one

An external node exists so another node can consume something. One publishing
nothing is a node nothing can need, which is the argument
[component §5](../../specifications/component/v1/spec.md#workload) already makes
for a `SERVICE` that exposes no endpoint. Both spellings of "none" are rejected
and carry the codes that section gives them: an absent `contract` is
`ERR_MISSING_FIELD` and an empty `outputs` mapping is `ERR_INVALID_VALUE`.

`DERIVED` means "the platform, from the running workload", and there is no
running workload. `DECLARED` stays available, and so does §3's `INPUT`.

A `platformDefault` and a `generator` are both rejected on an external
component's inputs, for the pair of reasons
[component §6.1](../../specifications/component/v1/spec.md#inputs) already gives
for excluding them beside `suppliedBy: CONNECTION`: a platform default derives
from the component's own public addressing, which an external node does not
have, and a generator mints a secret this platform would then not be sharing
with the service that has to accept it.

**The exclusion is about what `SELF_ADDRESS` means, not about platform defaults
as a class.** `platformDefault.type` has one member today and it reads the
component's own addressing. A second kind that resolved a value from a resource
the organisation holds would be meaningful on exactly this shape, and widening
the rule to admit it is a relaxation and free forever. Recorded as a gap in
component §10 so the exclusion is not later read as a considered permission.

### 3. An output may read one of its own component's inputs

`valueFrom` gains a third member, `INPUT`, and a sibling `input` names which of
this component's own inputs the value is read from.

```yaml
outputs:
  baseUrl:
    valueFrom: INPUT
    input: baseUrl
    schema: { … }
```

**`input`, not `inputRef`.** ADR 0007 §1's `…Ref` rule is for a reference to
another *object*; this names a sibling mapping key in the same document, which
this contract already spells as a bare noun — a probe's `endpoint`, a platform
default's `endpoint`, a connection's `fromRole` and `fromOutput`.

**There is no expression language and this does not introduce one.**
[ADR 0005](0005-platform-divergence-reconciliation.md) §5 rejected
`self.publicAddress.<endpoint>` on the ground that this contract has no
expression language and references are structural fields. `input` is a
structural field.

**Why this does not break the rule it looks like it breaks.** Component §6.2
says an output MUST NOT depend on a value the component received over an inbound
connection, and states its own reason immediately after: every output in a
composition is resolvable before any connection is bound, so a cycle among the
connections leaves nothing unresolved — which is what makes
[blueprint §4.2](../../specifications/blueprint/v1/spec.md#connections)'s legal
cycles sound.

Measured against that reason rather than its wording, a `USER` input resolves at
install-form submission, which is *earlier* than a `DERIVED` output resolves —
that one needs a running, addressed workload. A generated input is minted at
deploy time from nothing. A `platformDefault` reads the component's own
addressing, which §6.1 already says is "the same line §6.2 draws around an
output". Only a `CONNECTION` input resolves after an edge is bound.

So §6.2 was written as a sufficient condition and the necessary one is one step
weaker: an output may read an input whose `suppliedBy` is not `CONNECTION`.
Nothing about `DECLARED` or `DERIVED` changes.

### 4. A connection may fill only a `CONNECTION` input

§3's argument holds only if a `USER` input cannot itself be filled by a wire,
and today nothing says it cannot. Blueprint §4.2 records the silence:

> Nothing stops a connection filling an input whose `suppliedBy` is `USER`. A
> wire and the install form would then both claim the value, with nothing saying
> which arrives. That silence is a gap rather than a considered permission.

It is closed: a connection's map key MUST name an input whose `suppliedBy` is
`CONNECTION`, `semantic`, `ERR_INPUT_NOT_CONNECTABLE`.

**This is the one narrowing, and the reason it is taken now.** §4.2 says
outright that closing this gap rejects compositions that validate today, so it
is free only inside ADR 0005 §1's window. It is also independently correct on
the terms this contract already uses elsewhere: two claimants for one value with
nothing saying which arrives is the failure §5.2 rejects for merging and §5.3
rejects for coverage, and admitting it at the third door would be the only place
this contract tolerates it.

Recorded plainly: no mechanical gate detects this one. It is a `semantic` rule,
so `task changes` and `check:compat` are both blind to it, and the declaration
has to be written into the commit trailer by hand.

### 5. `resourceType` is read at node scope, and a URL is not sniffed

`spec.external.resourceType` is REQUIRED and takes
[ADR 0009](0009-resource-type-registry.md) §1's grammar and §2's registry
surface unchanged. It is REQUIRED rather than optional for the reason
[ADR 0018](0018-install-form-presentation.md) §5 gives for
`platformDefault.type`: an identifier a document may leave out is one two
implementations may read differently, and introducing it later is introducing a
required field later.

**Node scope and value scope are two different claims, and both are needed.**
A value's `resourceType` says what that value addresses, which is what a
connection compares. A node's says what the node is, which is what a consumer of
the graph reads to know it is looking at one thing rather than three. Three
tagged outputs do not compose into a node identity, and electing one of them as
the node's identity is the designated-primary mistake
[listing §3](../../specifications/listing/v1/spec.md#identity) rejects for a
`COMPONENT` item. One grammar, one registry, two placements answering two
questions — the same grammar-here, membership-there split blueprint `size`
already has.

**Rejected: recognising a prefilled address instead.** The alternative on the
table was for a consumer to notice that a value looks like an address it
operates itself, and render accordingly. It fails on four counts:

- **The graph is drawn before the form is filled.** At the moment a consumer
  wants to show what a composition contains, no value has been supplied. A hook
  keyed on a value is unavailable exactly when it is needed.
- **No phase tests a value.** Component §6.3 records it: nothing checks a value
  against the shape its own `schema` declares. A consumer branching on a value
  is deciding something no validation layer decides, which is the defect
  ADR 0018 §1 exists to close.
- **It cannot be written down.** ADR 0018 §1 made the schema-to-control
  derivation normative prose keyed on the document. A rule about a substring of
  a value the document does not contain cannot go in that table, so it would
  live only in one implementation.
- **It inverts the feature.** The specialised rendering would appear for the
  case that needed help least and vanish the moment a user pointed the node at
  something else — the case the node exists for.

**Follow-up this creates.** ADR 0009 §4's registry contract records a primitive
type per identifier, on the ground that a tag implies one. A node-scope
identifier has none. The registry gains a scope, and the primitive type becomes
conditional on the value scope. That is a change to the surface
`musher-dev/platform` serves, not to any schema here, and is filed there.

### 6. A node deploying an external component names no compute

`size` is REQUIRED on every node and holds a Compute Profile slug. A node that
runs nothing has no profile, so `size` admits `null` — and the field stays
REQUIRED, so an author records "deliberately no compute" rather than leaving it
out.

**This is ADR 0007 §5's third surviving placement, and it is named here because
that section named only two.** §5's rule is that a field accepts `null` only
where `null` means something omission does not. Here omission is not available:
`size` is REQUIRED, so absence means the author forgot, and `null` is the only
spelling left for a deliberate none. It is the same argument §5 accepts for
`schedule`, reached from the opposite direction — `schedule` is a forbidden
field written empty, `size` is a required field with nothing to say.

**Rejected: making `size` optional and re-imposing it semantically.** A
blueprint cannot see whether its node's component is external: `componentRef` is
a path or a UUID, and reading the referenced document is `semantic` for the
repo-local form and `capability` for the published one. A structural rule
conditioned on whether the component is external is therefore not available,
and relaxing `size` to optional would trade a total offline rule for one that
goes silent on a
published reference and needs `ERR_MISSING_FIELD` reported from a phase it is
not registered in.

Agreement between the node and the component it deploys is then an ordinary
`semantic` rule — `size` is null if and only if the component is external,
`ERR_CONFLICTING_NODE_COMPUTE` — and it goes silent for a published reference in
the words blueprint §5.3 already uses for every rule that reads a referenced
component.

A placement pin narrows the hosts a node may be placed on, and a node placed on
none has nothing to narrow, so `placement` is rejected beside `size: null`
rather than ignored. That is `structural`, and it constrains a state no document
can currently reach.

## Alternatives considered

**Three tagged inputs on the consuming component, and no new node.** The
cheapest option by a wide margin: the consumer declares an address, a credential
and a name as ordinary `USER` inputs, each carrying a `resourceType`, and a
second `platformDefault.type` prefills them from a resource the organisation
holds. It delivers most of the behaviour and it is entirely additive.

It was declined on §Context's constraint. The three fields are independent, so
nothing structurally guarantees they came from one provider, and the contract
has no place to say they must. It also leaves a consumer of the graph with one
node where the composition has two participants, so the thing the deploying user
is choosing does not appear in the graph at all. Recorded rather than buried,
because the deferred half of it — the second `platformDefault` kind — is what
makes this feature pleasant and should be proposed on its own terms.

**A typed requirement the blueprint or the installer binds.** The Score and
Radius model: the component declares a hole, and something else says how it is
filled. The one thing it buys that this ADR's shape does not is a blueprint
published with an *unbound* hole for the deploying user to fill at install time.

Declined as premature rather than wrong. Matching a producer by `resourceType`
instead of by output name is a real gain and stays additive on top of this
shape, so nothing here forecloses it; and conditional topology — a blueprint
whose node set depends on a form answer — is not a field but a different
specification, because it makes blueprint §5.1's derivation a function of its own
output. Recorded as foreclosed-for-a-reason in blueprint §9 rather than left for
a later proposal to discover.

**A fourth family.** A `provider` or `connection` document beside `component`,
`blueprint` and `listing`. Declined on a category test before a cost one: every
existing family is an authored, versioned template that lives in a repository
and is identified by its path, and each carries identity rules —
`LIST-ID-001`, `BP-ID-001` — that bind `metadata.slug` to a directory name. What
a fourth family would hold is one instance, owned by an organisation, holding a
live credential, created through an API and identified by an opaque id. It has
no directory, so every identity rule in the family would have no second operand.
GOVERNANCE.md's scope already sends that object to `musher-dev/platform`.

The clinching argument is ADR 0003's own, one rung up. §1's test is that a term
which becomes real when something outside this repository is provisioned does
not belong here. A family whose every instance becomes real by provisioning is
the same category error at the level of the family — and a family, once tagged,
cannot be withdrawn.

## Consequences

**A catalog item can say what it needs.** `open-webui`'s workaround default
becomes a second node, and the deploying user is asked for an address and a
credential once, together, through the install form blueprint §5.1 already
derives.

**One narrowing, paid for by a window that closes by hand.** §4 rejects
compositions that validate today. Every other decision here constrains a state
no document can currently reach, or relaxes one.

**The definition is reusable and the configured instance is not.** A component
document is reusable by construction — many blueprints may reference one, and
`listing.listingKind: COMPONENT` already admits a catalog item that is a single
standalone building block, so a generic external component ships as its own item
with no listing-family change. What is *not* expressible is one configured
instance shared by three blueprints: blueprint §4.2 is explicit that a
connection cannot reach outside the graph it is written in. Recorded as a gap in
component §10 and blueprint §9 rather than described as though the spec provided
it.

**An external address must not become an egress vector.** The address on an
external node is author- or user-supplied, and nothing in this contract may
induce the platform to fetch it — no probe, no reachability check. Component §11
says so, because the alternative is a specification that hands an implementation
a server-side request forgery vector and calls it validation.

**Three new diagnostics and one new `valueFrom` member.**
`ERR_UNKNOWN_INPUT_REFERENCE` and `ERR_INPUT_NOT_REFERENCEABLE` are component's,
`ERR_INPUT_NOT_CONNECTABLE` and `ERR_CONFLICTING_NODE_COMPUTE` are blueprint's.
Reuse was preferred where it was honest: blueprint's existing
`ERR_UNKNOWN_INPUT` was considered for §3's reference and declined, because it
means a different relationship anchored in a different document, and component
§8's cross-family exception runs component-to-blueprint and never the reverse.
