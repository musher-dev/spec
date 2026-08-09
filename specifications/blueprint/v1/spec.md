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

> **TODO** — `metadata.slug` MUST equal the containing item directory name;
> `metadata.version` MUST agree with the sibling listing document. State the
> diagnostic codes for each violation and which phase detects them.

## <a id="components"></a>4. Component graph

`spec.components` is a mapping from **graph-local node name** to a component
reference. The node name is the identifier used by connections; it is local to
this blueprint and carries no meaning outside it.

> **TODO** — Node name grammar and uniqueness.

> **TODO** — Resolution of the `component` field. In the catalog authoring
> dialect it names a sibling file stem under `components/`; on the API it is a
> component id plus version. State both bindings explicitly and which contexts
> use which — this is the single largest source of confusion in the current
> format.

> **TODO** — `size` MUST name a Compute Profile in `family.tier.size` form.
> State whether an unknown profile is a `semantic` or a `capability` failure.

### <a id="connections"></a>4.1 Connections

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
family — reference resolution and cycle detection both live there.

## <a id="diagnostics"></a>7. Diagnostics

The codes in [component §8](../../component/v1/spec.md#diagnostics) apply. This
family adds:

| Code | Phase | Meaning |
|---|---|---|
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
