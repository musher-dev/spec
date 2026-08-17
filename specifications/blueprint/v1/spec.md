# Musher Blueprint Document — Specification v1

**Status:** Draft (pre-stable)
**Family:** `blueprint`
**Schema:** `https://schemas.musher.dev/blueprint/v1/blueprint.schema.json`

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when, and only when, they
appear in all capitals, as shown here.

> **What is normative.** This document defines the complete behaviour of the
> specification. The JSON Schema bundle is its executable form for structural
> validity, and the [conformance corpus](../../../conformance/README.md) is its
> executable form for observable outcomes; both are normative, and neither is
> permitted to disagree with this document or with the other. Schema
> `description` fields, examples, generated documentation, and validator message
> text are informative.
>
> A disagreement between two normative artifacts is a defect in this
> specification and blocks a release. Until it is fixed this document governs —
> but that is how to read a broken contract, not a licence for the schema to be
> wrong.

---

## <a id="scope"></a>1. Scope

A **Blueprint Document** composes one or more
[Component Documents](../../component/v1/spec.md) into a single deployable
application: which components participate, how large each runs, and how they
are wired to one another.

The blueprint is the unit of deployment.

**Out of scope for this document**

- One workload's own definition → `component` family
- Storefront presentation → `listing` family
- API request and response bodies, including the optimistic-lock token carried
  by a declarative-apply call → the Musher API. A document a human writes into
  a repository does not carry a lock token; see [§3](#identity).
- The `apiVersion: musher.dev/v1`, `kind: App` shape read by `musher deploy`.
  [ADR 0001](../../../docs/adr/0001-canonical-repository-architecture.md) §2
  declines to ratify it. It is superseded by a repo-local `blueprint` document
  paired with its `component` documents, which the reference form in
  [§4.1](#component-reference) makes expressible.

## <a id="envelope"></a>2. Document envelope

```yaml
specVersion: v1
kind: BLUEPRINT
metadata: { slug: …, version: … }
spec: { components: {…}, parameters: {…} }
```

`kind` MUST be `BLUEPRINT`. All envelope rules in
[component §2](../../component/v1/spec.md#envelope), and the version
compatibility rules in
[component §3](../../component/v1/spec.md#compatibility), apply identically.

## <a id="identity"></a>3. Identity

`metadata` carries `slug` and `version`, and nothing else. A record identifier
and a concurrency token — the `id` and `rowVersion` an API carries on a
declarative apply — describe a row in a control plane, not a document. They
MUST NOT appear on a blueprint document, and a validator MUST reject them with
`ERR_UNKNOWN_FIELD` like any other unknown property.

Three rules bind the item together. All three are `semantic`, and all three
are measured against the item root defined below.

| Rule | Diagnostic |
|---|---|
| `metadata.slug` MUST equal the item directory name. | `ERR_SLUG_MISMATCH` |
| `metadata.version` MUST equal the sibling listing's `metadata.version`. | `ERR_VERSION_MISMATCH` |
| Every component document in the item MUST be referenced by some node. | `ERR_UNREFERENCED_COMPONENT` |

**An unreferenced component document is an error, not dead weight.** A
component nothing references is not deployed, not checked against any node,
and not visible to a reader working out what the item contains. Permitted, it
accumulates: last release's `postgres.yaml` sitting beside the one actually in
use, with nothing in the directory saying which is live. The diagnostic
anchors at `/spec/components` — the mapping that should have named the file —
because a JSON Pointer addresses this document, and the file it is complaining
about is not in it.

### <a id="item-directory"></a>3.1 The item directory

A blueprint does not travel alone. It and its sibling listing belong to a
**catalog item**: one directory holding one deployable thing.

```
<slug>/
  blueprint.yaml        this document
  listing.yaml          the sibling storefront entry
  components/           the component documents the graph references
  media/                icon and screenshots
```

The directory containing `blueprint.yaml` is the **item root**. It is what
§3's three rules are measured against, what
[§4.1](#component-reference) means by containment, and what
[listing §5](../../listing/v1/spec.md#media) resolves a media path inside.

Only two names in that tree are fixed: `blueprint.yaml` and `listing.yaml`.
Component documents MAY sit anywhere under the root — `components/` is a
convention, and [§4.1](#component-reference) accepts a flat sibling equally.
`media/` is fixed too, but by the listing family rather than by this one.

**A document with no directory has no item root.** Every rule in this section
needs one, so an implementation handed a document rather than a directory MUST
NOT report any of them. It has not been given the means to check, and a
diagnostic it cannot substantiate is worse than a silence.
[§4.1](#component-reference) draws the same line for the component reference,
for the same reason.

## <a id="components"></a>4. Component graph

`spec.components` is a mapping from **graph-local node name** to a component
reference. The node name is the identifier used by connections; it is local to
this blueprint and carries no meaning outside it.

`spec.components` is REQUIRED and MUST declare at least one node. [§1](#scope)
makes a blueprint a composition of one or more component documents, and an
empty graph deploys nothing while claiming to be the unit of deployment. Both
halves are `structural`: an absent mapping is `ERR_MISSING_FIELD` and an empty
one `ERR_INVALID_VALUE`.

A node name MUST match `^[a-z][a-z0-9-]{0,61}[a-z0-9]$`, the same grammar
`metadata.slug` uses. Uniqueness needs no rule of its own: `spec.components`
is a mapping, so a repeated node name is `ERR_DUPLICATE_KEY` in the `parser`
phase, before the graph is looked at.

The name is graph-local, which is to say it means nothing outside this
document. Two blueprints MAY each declare a node called `db` and neither is
the other's. Its one job is to be what [§4.2](#connections) `fromRole` names,
and what [§5.2](#merge) orders the graph by.

A node carries three things: the component it deploys ([§4.1](#component-reference)),
the wires feeding it ([§4.2](#connections)), and the compute it runs on
([§4.3](#node-compute)).

### <a id="component-reference"></a>4.1 Component reference

A node names the component it deploys with a single field, `component`. The
**form** of the value selects how it resolves. There is exactly one field for
this concept; a second parallel key naming the same slot is what made the
earlier dialects mutually unreadable.

Two forms are defined.

**Repo-local.** The reference MUST begin with `./` or `../` and MUST end with
`.yaml` or `.yml`. It is resolved relative to the directory containing the
referencing blueprint document. Every path segment MUST begin with a letter or
a digit, so `.` and `..` are not valid interior segments: each referenced
document has exactly one spelling.

```yaml
db:
  component: ./components/postgres.yaml
  size: general.standard.small
  connections: {}
```

`componentVersion` MUST NOT be present. The version deployed is the referenced
document's `metadata.version`, so a second version here could contradict it
with no rule saying which wins.

**Published.** The reference is the component's UUID, and `componentVersion`
MUST be present.

```yaml
db:
  component: 550e8400-e29b-41d4-a716-446655440000
  componentVersion: 3
  size: general.standard.small
  connections: {}
```

A reference matching neither form MUST be rejected in the `structural` phase.

**Why the prefix is required.** A bare name is not distinguishable from a
UUID: the slug grammar `^[a-z][a-z0-9-]{0,61}[a-z0-9]$` matches
`e29b8400-e29b-41d4-a716-446655440000`. Without a prefix no validator could
decide which resolver a reference wanted, so the prefix is load-bearing rather
than decorative.

**The local form imposes no directory layout.** `./components/postgres.yaml`
and `./component-web.yaml` are equally valid. A blueprint MAY sit beside its
components in one flat directory.

**Where each form resolves.** A repo-local reference is resolved in the
`semantic` phase: it reads the filesystem, which
[component §7](../../component/v1/spec.md#validation-layers) permits, since
that phase MUST NOT require network access. A published reference cannot be
resolved under that constraint and therefore belongs to the `capability`
phase, server-side. An offline client MUST NOT report a published reference as
unresolvable; it has not been given the means to check. A published reference
naming no component, or naming one without the requested `componentVersion`,
MUST be rejected with `ERR_UNKNOWN_COMPONENT`.

Resolving is not the whole of it. A component the catalog holds but has not
published is not deployable, and a reference to one MUST be rejected with
`ERR_COMPONENT_NOT_PUBLISHED`. What counts as published is the registry's to
define — this contract says only that the two failures read differently to an
author, since a component that exists and is not yet released is a wait rather
than a typo. Both are `capability`, for the reason above, so neither can carry
a fixture.

A context holding no filesystem location for the document — a document
submitted over an API, for example — has no base directory to resolve against.
It MUST reject a repo-local reference with `ERR_COMPONENT_NOT_FOUND` rather
than assume a base. Guessing one is what let the same field mean two different
things depending on who was reading it.

A repo-local reference MUST resolve to a document inside the item root.
`../` segments that escape it MUST be rejected with `ERR_REFERENCE_ESCAPE`, and
a reference naming no document with `ERR_COMPONENT_NOT_FOUND`. Both are
`semantic`, both are decided after normalising the path — containment is a
property of the resolved location, not of the spelling.

**Reserved.** A third form, `<publisher>/<slug>`, is reserved for a public
registry and is not implemented. It will require `componentVersion`. Until it
is specified, a reference of that shape matches no form and is rejected.

### <a id="connections"></a>4.2 Connections

Connections are **consumer-anchored**: the node that needs a value declares
where it comes from. A component never declares who consumes it.

```yaml
connections:
  DATABASE_URL:
    fromRole: db
    fromOutput: connectionString
```

The producer end MUST resolve.

- `fromRole` MUST name a node in this blueprint. A connection cannot reach
  outside the graph it is written in. `ERR_UNKNOWN_ROLE`.
- `fromOutput` MUST name an output declared by the component that node
  deploys. `ERR_UNKNOWN_OUTPUT`.

Both are `semantic`. The first needs only this document; the second needs the
referenced component document, which a repo-local reference makes readable
without a network.

**The consumer end MUST resolve too**, and it is named rather than written: the
map key is the input being filled, and the enclosing node is the consumer. A
key naming no input of the component that node deploys is `ERR_UNKNOWN_INPUT`
— the mirror of `ERR_UNKNOWN_OUTPUT`, needing the same referenced document and
carrying the same argument. A wire whose two ends are each checked and whose
consumer end is not is a wire that can be misspelled at one end only.

Uniqueness needs no rule. One input cannot take two wires, because the map key
is what names it — a second wire to the same input is a repeated mapping key
and therefore `ERR_DUPLICATE_KEY` in the `parser` phase. That is a property of
how a connection is spelled, not an omission from this section.

**A required `CONNECTION` input MUST be wired.** An input declaring
`suppliedBy: CONNECTION` is satisfied by a wire and by nothing else
([component §6.1](../../component/v1/spec.md#inputs)) — it never reaches the
install form, so a graph that leaves one unwired has no later chance to supply
it. Where such an input is also `isRequired` — which is its default — and no
connection on that node names it, the blueprint is rejected with
`ERR_UNWIRED_REQUIRED_INPUT`, anchored at the node's `connections`. An optional
`CONNECTION` input MAY be left unwired.

**What v1 does not constrain.** Nothing stops a connection filling an input
whose `suppliedBy` is `USER`. A wire and the install form would then both claim
the value, with nothing saying which arrives. That silence is a gap rather than
a considered permission; closing it rejects compositions that validate today.

**The two ends MUST fit.** Resolving both ends establishes only that they
exist. A `STRING` output wired into an `INTEGER` input satisfies every rule
above, and fails at deploy time inside the consuming workload — the failure
shape [§5.2](#merge) rejected for input merging, on the grounds that it lands
"a long way from the two documents that disagreed and with nothing pointing
back at them". The argument is the same here, so the answer is.

Both ends always carry a `schema`, and `type` is REQUIRED on one
([component §6.1](../../component/v1/spec.md#inputs),
[component §6.2](../../component/v1/spec.md#outputs)), so there is no
unconstrained producer to make an exception for. Two axes are compared. Both
are `semantic`, both need the referenced component documents, and both anchor
at the connection's `fromOutput`.

**`type` MUST be equal.** A mismatch is `ERR_INCOMPATIBLE_TYPE`. No widening is
permitted, in either direction. An `INTEGER` output feeding a `STRING` input
looks harmless — everything is a string by the time it reaches a container —
but *which* string is a decision each language's formatter makes differently,
and a contract that permitted the wire would be promising a value it cannot
describe. An author who wants the conversion writes an output that already has
the type the consumer asked for.

**`semanticType` MUST agree where the consumer names one.** A consumer
declaring `null` accepts any producer: it has said the value is not specific to
a backing service, and nothing it receives can contradict that. A consumer
declaring a tag requires a producer declaring the **same** tag — including
rejecting a producer that declares `null`, because an unconstrained producer
does not satisfy a constrained consumer. A mismatch is
`ERR_INCOMPATIBLE_SEMANTIC_TYPE`.

That is what `semanticType` is for, given `type` exists. `type` is the
primitive shape; `semanticType` is the backing service the value addresses. A
Postgres connection string and a MySQL one are both `STRING`, both plausibly
`CONNECTION_STRING`-formatted, and wiring one into a consumer expecting the
other is the mistake the tag exists to catch.

**What v1 does not compare.** `format`, `enum`, `pattern`, `default` and
`isSensitive` take no part in the decision. A producer whose `pattern` admits
more than the consumer's does is accepted, and nothing checks that a
non-sensitive output is not wired into a sensitive input. Those silences are
gaps rather than considered permissions, recorded here so a reader can tell the
two apart; closing any of them rejects compositions that validate today.

**The connection graph MAY contain a cycle.** Two nodes MAY each consume an
output of the other, and an implementation MUST NOT reject a composition for
that reason alone.

The rule follows from one already stated. An output is a function of its own
node and nothing else
([component §6.2](../../component/v1/spec.md#outputs)), so every output in the
graph is resolvable before any edge is bound. Resolution is one pass over a
finite set of nodes: it needs no topological order, and there is no order for a
cycle to contradict. A cyclic graph is not a resolution hazard, and rejecting
one would be rejecting a document nothing in this contract cannot process.

What it permits has a name. **Mutual service discovery** — two services that
each need the other's address — is a composition an author writes deliberately,
and it is expressible only if a cycle is legal. A rule that forbade it would be
spending a working capability.

**What this forecloses, stated rather than discovered later.** No rule in this
version depends on the order in which nodes are materialised, and a later one
that did — an ordered rollout, a health-gated start, a value that legitimately
depends on an inbound edge — would need an acyclic graph to be meaningful.
Requiring acyclicity after publication rejects compositions that validate
today, so such a rule is a new major version rather than an addition to this
one. Anyone proposing one should know that before starting rather than
afterwards.

### <a id="node-compute"></a>4.3 Node compute

`size` is REQUIRED on every node and names the **Compute Profile** it runs on —
a provider-neutral machine tier, not a raw resource request. A component
document carries no compute of its own
([component §5](../../component/v1/spec.md#workload)), so the node is the only
place it can be said, and two blueprints MAY run the same component version at
different sizes without forking it.

```yaml
db:
  component: ./components/postgres.yaml
  size: general.standard.medium
  connections: {}
```

**A profile slug has three segments, `family.tier.size`.** Two layers enforce
it, and the split between them is deliberate.

The three segments are drawn from closed sets. A value outside them is rejected
in the `structural` phase with `ERR_INVALID_VALUE`.

| Segment | Members |
|---|---|
| family | `general`, `compute`, `memory`, `storage`, `gpu`, `accelerator` |
| tier | `economy`, `standard`, `performance`, `premium` |
| size | `nano`, `small`, `medium`, `large`, `xlarge` |

That is a grammar, so the schema carries it. The last segment shares the field's
name and is not the field: `size` holds the whole slug, and `small` is one third
of one.

A tier names a capability band rather than a workload — for the `gpu` and
`accelerator` families, `economy` through `premium` run entry inference to
frontier training. The exact accelerator is not encoded in the slug; it is
pinned, if at all, by [§4.4](#advanced-constraints).

**A grammatical slug is not necessarily an offered one.** Which profiles are
actually available is not a property of this document, and a node naming one
that is not is rejected with `ERR_UNKNOWN_COMPUTE_PROFILE` in the `capability`
phase. Deciding it needs the catalog, which needs the network, which
[§6](#validation-layers) forbids the earlier phases from reaching — so an
offline implementation MUST NOT report it, on the same grounds
[§4.1](#component-reference) gives for a published component reference. It has
not been given the means to check.

**Where the vocabulary is published.** The profiles on offer are served,
unauthenticated, at
`https://api.musher.dev/v1/reference/compute-profiles`, and rendered for a
reader at <https://docs.musher.dev/reference/compute-profiles>. The endpoint
lists what can be deployed now; a slug the grammar admits and the endpoint does
not name is reserved rather than available.

**Why the vocabulary is not an `enum`.** The grammar is settled and the
membership is not: a profile becomes available when the platform has hardware
to back it, which is not an event this specification can observe and not one a
release of it coincides with. A schema that enumerated the offering would be
wrong in both directions between releases — naming tiers that cannot yet be
deployed, and rejecting ones that can. Growing the *grammar* is safe by
contrast, because an allowlist admitting more is a relaxation and ships in a
minor release ([component §3](../../component/v1/spec.md#compatibility));
narrowing one would be major. That is the mirror of
[component §5.1](../../component/v1/spec.md#source), where the floating-tag
blocklist stays out of the schema precisely because growing a *blocklist* is a
narrowing.

**A bare slug, and never a versioned one.** A profile is versioned where it is
published, and a slug carrying that version is not a value this field takes —
the grammar has three segments and rejects a fourth. A node names the profile
and gets the current version of it, which means the vCPU and memory behind a
slug MAY differ between two deployments of an unchanged document. That is the
point of naming a tier rather than a machine: a name like `4vcpu-16gb` fixes
numbers it cannot keep, promising identical silicon across hardware generations
that do not deliver it.

### <a id="advanced-constraints"></a>4.4 Advanced constraints

`advanced` is OPTIONAL and narrows the hosts a node may be placed on. Absent,
`null`, and a block whose every pin is unset all mean the same thing: no
constraints. A pin whose value is an array means "any" when the array is empty,
and MUST NOT repeat a term.

| Pin | Narrows |
|---|---|
| `cpuArchitecture` | Permitted CPU architectures |
| `cpuDedication` | `shared` or `dedicated` |
| `acceleratorMinVramGb` | Accelerator VRAM floor |
| `acceleratorRuntime` | Required accelerator runtimes |
| `acceleratorInterconnect` | Required accelerator interconnect |
| `acceleratorSkuClass` | Exact accelerator SKU class |
| `storageClass` | Required storage class |
| `storageMinIops` | Provisioned IOPS floor |
| `networkClass` | Required network class |

**A pin narrows placement and nothing else.** `size` remains what the node runs
as; a pin only reduces the set of hosts that may run it. A node pinning
`cpuDedication: dedicated` gets the vCPU and memory its profile names, on a host
that dedicates them — never more compute than it asked for, and never a
substitute profile.

**A pin term is a lowercase token**, `^[a-z0-9][a-z0-9_-]*$`, which admits
`x86_64`, `arm64`, `local-nvme`, `nvlink` and `cuda`. Numeric pins are positive
integers. Both are grammar, both are `structural`, and a violation is
`ERR_INVALID_VALUE`. `cpuDedication` is the one pin whose vocabulary this
contract closes, because `shared` and `dedicated` are the whole of the concept
and a third value would be a different one.

**The two terms are not symmetric in effect.** `dedicated` narrows placement to
hosts that dedicate the vCPU the profile names; `shared` is that constraint's
absence written down, and selects the same hosts as leaving the pin unset. It is
spelled anyway because an author who has considered the question should be able
to record what they concluded, and because a platform that later offers a host
which must be shared can give the term force without touching this grammar.

**What v1 does not constrain.** No vocabulary is published for the other eight
pins — not by this repository and not, today, by the platform. `local-nvme` is
an example rather than a member, and nothing here says what the permitted
storage classes are. Nor does anything say what happens when no host satisfies a
pin: it is not decidable offline, and it carries no diagnostic in v1. Those are
gaps rather than considered permissions, recorded here so a reader can tell the
two apart. Naming a code for them would claim an implementation reports
something none does; closing them properly means publishing the terms first, at
which point they take the same shape `size` has above.

## <a id="parameters"></a>5. Parameters

`spec.parameters` is the install form: what a deploying user is asked for once,
for the whole composition, rather than once per node.

**Absent and empty mean the same thing.** Both say "derive the form from the
graph". An earlier draft of this section asserted a difference between them;
nothing in the document distinguishes a missing key from an empty mapping, and
a distinction no author can express is one that survives in a specification
and in no implementation.

A non-empty mapping is an authored override, used in place of derivation
rather than merged with it.

### <a id="derivation"></a>5.1 Derivation

When `parameters` is empty, the effective parameter set is derived from the
`USER`-supplied inputs of the components the graph references, merged by
[§5.2](#merge).

A `CONNECTION` input is never derived — it is satisfied by a wire, not by a
person. An input carrying a `generator` **is** derived, even though the user
never types a value for it: a client rendering the install form still has to
know it exists, and "three secrets will be generated for you" is a thing worth
being able to say.

A derived parameter takes the declaring input's `schema`, `ui` and
`isRequired` unchanged. [Component §6.1](../../component/v1/spec.md#inputs)
requires a `USER` input to carry `ui`, so every derived parameter arrives with
the label a form needs; there is no such thing as a derived parameter that
cannot be rendered.

### <a id="merge"></a>5.2 Merge

Two components MAY declare an input under the same key. The merge is
**first-wins in lexicographic node-name order**:

1. Sort the entries of `spec.components` by node name.
2. Walk them in that order, taking each `USER` input key not already taken.

Node name because it is the only total order the document itself supplies. A
mapping has no sequence, and a rule that depended on file order, on parse
order, or on an identifier internal to a control plane would not be
reproducible by someone reading the document.

The comparison is unambiguous across implementations: [§4](#components)
confines a node name to lowercase ASCII letters, digits and hyphens, so byte
order and lexicographic order coincide and no collation or locale can change
the result.

**A conflicting redeclaration is an error.** Where a later node declares a key
already taken and its declaration differs, the blueprint is rejected in the
`semantic` phase with `ERR_CONFLICTING_INPUT_SCHEMA`. An identical
redeclaration is absorbed in silence — two components that agree on what
`adminPassword` is are not in conflict, and making them say so twice in
different words would be the only way to trip this.

Two declarations are identical when their `schema` blocks are equal once
defaults are applied. `ui` and `isRequired` are not compared: they describe how
a value is asked for, not what it is, and the first node's presentation winning
is a presentation decision rather than a contract one.

**Why this is not silent first-wins.** Taking the first schema and discarding a
different second one settles the ambiguity without telling anyone there was
one. The second component then receives a value validated against the first
component's rules — a bare `STRING` where it required an enum member, a
64-byte secret where its pattern allowed 32. Nothing fails at validation time.
It fails at deploy time, inside the consuming workload, a long way from the two
documents that disagreed and with nothing pointing back at them.

An author who wants one shared value across two components says so by writing
`spec.parameters` outright, which is what an authored override is for.

**This rule belongs to the derivation path.** [§5](#parameters) makes an
authored override something used in place of derivation rather than merged with
it, so where `parameters` is non-empty the merge above does not run and there is
nothing left to conflict. That is what makes the remedy in the previous
paragraph a remedy: two components that disagree are reconciled by the author
naming the value once, rather than left in conflict beside the reconciliation.
What an authored parameter has to satisfy instead is
[§5.3](#authored-parameters).

### <a id="authored-parameters"></a>5.3 Authored parameters

An authored override replaces the derived parameter set outright. It is the
path [§5.2](#merge) sends an author to, and it carries obligations derivation
met for free.

**Binding is by key.** A parameter key is an input key: the parameter called
`adminPassword` supplies every `USER` input called `adminPassword`, in every
node that declares one. Nothing else is available to make the correspondence — a
parameter carries no `suppliedBy`, no node name and no `target` — so the key is
not one signal among several but the whole of it. That is also what lets one
parameter serve two components, which is the whole of why [§5.2](#merge) sends
an author here.

A parameter **covers** an input when their keys are equal. Three rules follow.
All are `semantic`, and all need the component documents the graph references,
which a repo-local reference makes readable without a network.

**A parameter MUST cover something.** A key matching no `USER` input of any node
is rejected with `ERR_UNBOUND_PARAMETER`, anchored at `/spec/parameters/<key>`.
The install form asks a deploying user for a value and nothing in the
composition ever reads it. Permitted, these accumulate exactly as
[§3](#identity) says an unreferenced component document does — last release's
`legacyMode` still on the form beside the parameters that do something, with
nothing in the document saying which is which.

**An input the deploying user must supply MUST be covered**, and covered by a
parameter that will actually ask for it. Otherwise the component requires a
value, the install form never offers one, and the workload starts without it.
The blueprint is rejected with `ERR_UNCOVERED_REQUIRED_INPUT`, anchored at
`/spec/parameters` — the mapping that should have named it, since a JSON Pointer
addresses this document and the input it is complaining about is not in it.

An input must be covered when every one of these holds:

| Property | Value | Because |
|---|---|---|
| `suppliedBy` | `USER` | A `CONNECTION` input is satisfied by a wire ([§4.2](#connections)). |
| `isRequired` | true, its default | Nothing has to supply an optional input. |
| `generator` | absent | The platform mints the value. |
| `platformDefault` | absent | The platform derives it from the node's own addressing. |
| `schema.default` | absent | The component document already supplies it. |

A parameter covers such an input only if it **guarantees a value**: it declares
`isRequired: true`, or it carries a `generator`, or its `schema` declares a
`default`. A parameter that names the key and leaves the value optional has
moved the omission rather than closed it.

**`isRequired` reads in opposite directions on the two documents**, and this is
the rule where that bites. It defaults to `true` on a component input and to
`false` on a blueprint parameter, so an override that copies a required input's
key and says nothing else has quietly made it optional. The defaults are
defensible on each side alone — an input declares a need, a parameter declares a
question — but the asymmetry is a trap, and it is why the rule above tests what
a parameter guarantees rather than only which keys it names.

**`type` MUST agree.** Where a parameter covers an input, its `schema.type` MUST
equal that input's, and a mismatch is `ERR_INCOMPATIBLE_PARAMETER_TYPE`,
anchored at `/spec/parameters/<key>/schema/type`. The deploying user is
validated against the parameter's schema and the component then receives the
result against its own: a `STRING` accepted at the form where the workload
expects an `INTEGER` is the failure [§4.2](#connections) rejected for
connections and [§5.2](#merge) rejected for merging, arriving through a third
door.

**A generated parameter is secret material.** A parameter carrying a `generator`
MUST declare `schema.isSensitive: true`, and MUST declare it rather than leave
it to a default. That is a shape rather than a relationship, so both halves are
`structural`: an absent `isSensitive` is `ERR_MISSING_FIELD` and one written
`false` is `ERR_INVALID_VALUE`.
[Component §6.1](../../component/v1/spec.md#inputs) requires exactly this of a
generated input, and a derived parameter takes the input's `schema` unchanged
([§5.1](#derivation)), so the marking is guaranteed on the derivation path
already. Without the same rule here, moving a generated secret onto the override
path is enough to lose it — and `isSensitive` defaults to `false`, so losing it
takes no more than not mentioning it.

**What v1 does not compare.** `format`, `enum`, `pattern`, `default`,
`isSensitive` and `ui` take no part in whether a parameter covers an input. A
parameter whose `pattern` admits more than the input's does is accepted, and so
is one that asks for a value the input would reject. `semanticType` is not
compared because a parameter has none to compare: it tags the backing service a
value addresses ([§4.2](#connections)), and an install form is not where a value
acquires one. Those silences are gaps rather than considered permissions,
recorded here so a reader can tell the two apart; closing any of them rejects
compositions that validate today.

**None of this reaches a published reference.** All three rules read the
referenced component's inputs, so a node naming its component by UUID
contributes none of them ([§4.1](#component-reference)). A blueprint mixing the
two forms is checked against the repo-local half and no further, and an
implementation MUST NOT report an input it was never given the means to read.

**And one of the three stops being decidable.** The coverage and type rules read
only the inputs in front of them, so an unreadable node subtracts from what they
check and does nothing else. `ERR_UNBOUND_PARAMETER` is the mirror image: it
asserts that *no* node declares the key, which is a claim about every node's
inputs. Where any node's component is unreadable — a published reference, or a
repo-local one already rejected as naming no document or as escaping the item
root — an implementation MUST NOT report `ERR_UNBOUND_PARAMETER` for any
parameter. The claim becomes decidable again only when every node's inputs were
readable, and a diagnostic an implementation cannot substantiate is worse than a
silence, which is the trade [§3](#identity) already makes for a document handed
over without a directory.

## <a id="validation-layers"></a>6. Validation layers

As defined in [component §7](../../component/v1/spec.md#validation-layers), and
written in the YAML profile
[component §7.1](../../component/v1/spec.md#yaml-profile) states.
Blueprint documents exercise the `semantic` phase more heavily than any other
family — repo-local reference resolution, connection compatibility, and the
parameter merge all live there.

Published reference resolution is the exception: it needs the catalog, so it
belongs to `capability`. A blueprint composed entirely of repo-local references
therefore validates completely offline, all the way through `semantic`.

## <a id="diagnostics"></a>7. Diagnostics

The codes in [component §8](../../component/v1/spec.md#diagnostics) apply. This
family adds:

| Code | Phase | Meaning |
|---|---|---|
| `ERR_COMPONENT_NOT_FOUND` | `semantic` | A repo-local `component` reference resolves to no document. |
| `ERR_REFERENCE_ESCAPE` | `semantic` | A repo-local `component` reference resolves outside the item root. |
| `ERR_UNKNOWN_COMPONENT` | `capability` | A published `component` reference names no component, or no such `componentVersion`. |
| `ERR_UNKNOWN_ROLE` | `semantic` | A connection's `fromRole` names no node in this blueprint. |
| `ERR_UNKNOWN_OUTPUT` | `semantic` | A connection's `fromOutput` names no output of the referenced component. |
| `ERR_UNKNOWN_INPUT` | `semantic` | A connection's map key names no input of the consuming node's component. |
| `ERR_UNWIRED_REQUIRED_INPUT` | `semantic` | A node's required `CONNECTION` input is satisfied by no connection. |
| `ERR_COMPONENT_NOT_PUBLISHED` | `capability` | A published `component` reference resolves to a component that is not in a published state. |
| `ERR_UNKNOWN_COMPUTE_PROFILE` | `capability` | A node's `size` names a Compute Profile the catalog does not offer. |
| `ERR_INCOMPATIBLE_TYPE` | `semantic` | A connection joins an output and an input whose `schema.type`s differ. |
| `ERR_INCOMPATIBLE_SEMANTIC_TYPE` | `semantic` | A connection joins an output and an input whose `schema.semanticType`s disagree. |
| `ERR_SLUG_MISMATCH` | `semantic` | `metadata.slug` disagrees with the item directory name. |
| `ERR_VERSION_MISMATCH` | `semantic` | `metadata.version` disagrees with the sibling listing document. |
| `ERR_UNREFERENCED_COMPONENT` | `semantic` | A component document in the item is referenced by no node. |
| `ERR_CONFLICTING_INPUT_SCHEMA` | `semantic` | Two nodes declare the same input key with different schemas. |
| `ERR_UNBOUND_PARAMETER` | `semantic` | An authored parameter's key names no `USER` input of any node. |
| `ERR_UNCOVERED_REQUIRED_INPUT` | `semantic` | An input the deploying user must supply is guaranteed a value by no authored parameter. |
| `ERR_INCOMPATIBLE_PARAMETER_TYPE` | `semantic` | An authored parameter and an input it covers declare different `schema.type`s. |

## <a id="conformance"></a>8. Conformance

An implementation conforms when it produces the declared outcome for every
fixture in [`conformance/blueprint/v1/`](../../../conformance/blueprint/v1/).

## <a id="known-debt"></a>9. Known debt

Seeded from the platform's generated schema. The naming that arrived with it
has been cleaned, and [§4.3](#node-compute) now names where the Compute Profile
vocabulary is published rather than assuming a reader can already resolve it.

No section of this document is marked TODO any longer. The last of them — how an
authored parameter binds to the component inputs it satisfies — is answered by
[§5.3](#authored-parameters).

What remains is not a gap in the prose but a vocabulary nothing publishes yet:
[§4.4](#advanced-constraints)'s compute-constraint pins, recorded there as a gap
rather than described as a decision. See also
[component §10](../../component/v1/spec.md#known-debt).
