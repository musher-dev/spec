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
[component §2](../../component/v1/spec.md#envelope) apply identically.

## <a id="identity"></a>3. Identity

`metadata` carries `slug` and `version`, and nothing else. A record identifier
and a concurrency token — the `id` and `rowVersion` an API carries on a
declarative apply — describe a row in a control plane, not a document. They
MUST NOT appear on a blueprint document, and a validator MUST reject them with
`ERR_UNKNOWN_FIELD` like any other unknown property.

> **TODO** — `metadata.slug` MUST equal the containing item directory name;
> `metadata.version` MUST agree with the sibling listing document. State the
> diagnostic codes for each violation and which phase detects them.

## <a id="components"></a>4. Component graph

`spec.components` is a mapping from **graph-local node name** to a component
reference. The node name is the identifier used by connections; it is local to
this blueprint and carries no meaning outside it.

> **TODO** — Node name grammar and uniqueness.

> **TODO** — `size` MUST name a Compute Profile in `family.tier.size` form.
> State whether an unknown profile is a `semantic` or a `capability` failure.

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

> **TODO** — Normative rules: `fromRole` MUST name a node in the same
> blueprint; `fromOutput` MUST name a declared output of that node's component;
> the output's type MUST be compatible with the consuming input's schema.

> **TODO** — **Cycle detection.** The connection graph MUST be acyclic. This is
> the canonical example of a rule JSON Schema cannot express; it belongs to the
> `semantic` phase with code `ERR_DEPENDENCY_CYCLE`. Specify how the cycle is
> reported (the participating node names, in a deterministic order).

## <a id="parameters"></a>5. Parameters

An empty `parameters` mapping is not the same as an absent one.

> **TODO** — Specify derivation: when `parameters` is empty, the effective
> parameter set is derived from the merged `USER`-supplied inputs of the
> referenced components. Define the merge rule for two components declaring the
> same input name with different schemas.

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
| `ERR_DEPENDENCY_CYCLE` | `semantic` | The connection graph contains a cycle. |
| `ERR_SLUG_MISMATCH` | `semantic` | `metadata.slug` disagrees with the item directory name. |
| `ERR_VERSION_MISMATCH` | `semantic` | `metadata.version` disagrees with the sibling listing document. |

> **TODO** — Confirm this list is complete once §4 and §5 are written.

## <a id="conformance"></a>8. Conformance

An implementation conforms when it produces the declared outcome for every
fixture in [`conformance/blueprint/v1/`](../../../conformance/blueprint/v1/).

## <a id="known-debt"></a>9. Known debt

Seeded from the platform's generated schema. The naming that arrived with it
has been cleaned; the sections above marked TODO have not. See
[component §10](../../component/v1/spec.md#known-debt).
