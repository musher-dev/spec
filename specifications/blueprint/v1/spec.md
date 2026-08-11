# Musher Blueprint Document — Specification v1

**Status:** Draft (pre-stable)
**Family:** `blueprint`
**Schema:** `https://schemas.musher.dev/blueprint/v1/blueprint.schema.json`

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as
described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

> **This document is normative.** Where it disagrees with a `description` field
> in the JSON Schema, this document wins.

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

A node name MUST match `^[a-z][a-z0-9-]{0,61}[a-z0-9]$`, the same grammar
`metadata.slug` uses. Uniqueness needs no rule of its own: `spec.components`
is a mapping, so a repeated node name is `ERR_DUPLICATE_KEY` in the `parser`
phase, before the graph is looked at.

The name is graph-local, which is to say it means nothing outside this
document. Two blueprints MAY each declare a node called `db` and neither is
the other's. Its one job is to be what [§4.2](#connections) `fromRole` names,
and what [§5.2](#merge) orders the graph by.

> **TODO** — `size` MUST name a Compute Profile in `family.tier.size` form.
> State whether an unknown profile is a `semantic` or a `capability` failure.
> The profile vocabulary itself is not defined in this repository and a reader
> outside the platform cannot resolve a slug like `general.standard.small`;
> naming where it is published is part of closing this.

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

The consumer end needs no rule of its own for uniqueness. The map key names the
input being filled and the enclosing node names the consumer, so one input
cannot take two wires — the mapping already makes that structural.

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

**The connection graph MUST be acyclic.** A cycle is rejected in the
`semantic` phase with `ERR_DEPENDENCY_CYCLE`.

This is the canonical rule JSON Schema cannot express, and it is worth being
straight about what it costs, because a resolver does not need it. An output
is a function of its own node and nothing else
([component §6.2](../../component/v1/spec.md#outputs)), so an implementation
that resolves every output before binding any edge needs no topological order
and does not fail on a cycle. Acyclicity is not a resolution hazard.

It is required anyway. A specification that permits cycles obliges every
implementation, in every language, to be that two-pass resolver in perpetuity,
and forecloses any later rule that needs an order — an ordered rollout, a
health-gated start, a value that legitimately does depend on an inbound edge.
It also obliges every reader of a blueprint to work out for themselves whether
the composition in front of them terminates. A two-node cycle is legible; a
six-node one is not. The rule costs one traversal, which is less than the
option it keeps open.

**Reporting a cycle.** The diagnostic MUST name the participating nodes as a
closed walk, beginning at the lexicographically smallest node name in the
cycle and following edges from there — `db → cache → queue → db`. Two
implementations that find the same cycle then report the same walk, which is
what makes the node names comparable across a conformance corpus instead of an
artifact of whichever node the traversal happened to start from. The
diagnostic anchors at `/spec/components/<first>/connections`.

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

> **TODO** — How an authored parameter binds to the component inputs it
> satisfies. Derivation makes that correspondence by key; an override is used
> verbatim, which does not say what happens to a parameter key matching no
> input, or to a `USER` input no parameter covers.

## <a id="validation-layers"></a>6. Validation layers

As defined in [component §7](../../component/v1/spec.md#validation-layers).
Blueprint documents exercise the `semantic` phase more heavily than any other
family — repo-local reference resolution and cycle detection both live there.

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
| `ERR_INCOMPATIBLE_TYPE` | `semantic` | A connection joins an output and an input whose `schema.type`s differ. |
| `ERR_INCOMPATIBLE_SEMANTIC_TYPE` | `semantic` | A connection joins an output and an input whose `schema.semanticType`s disagree. |
| `ERR_DEPENDENCY_CYCLE` | `semantic` | The connection graph contains a cycle. |
| `ERR_SLUG_MISMATCH` | `semantic` | `metadata.slug` disagrees with the item directory name. |
| `ERR_VERSION_MISMATCH` | `semantic` | `metadata.version` disagrees with the sibling listing document. |
| `ERR_UNREFERENCED_COMPONENT` | `semantic` | A component document in the item is referenced by no node. |
| `ERR_CONFLICTING_INPUT_SCHEMA` | `semantic` | Two nodes declare the same input key with different schemas. |

## <a id="conformance"></a>8. Conformance

An implementation conforms when it produces the declared outcome for every
fixture in [`conformance/blueprint/v1/`](../../../conformance/blueprint/v1/).

## <a id="known-debt"></a>9. Known debt

Seeded from the platform's generated schema. The naming that arrived with it
has been cleaned; the sections above marked TODO have not. See
[component §10](../../component/v1/spec.md#known-debt).
