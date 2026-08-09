# Musher Component Document — Specification v1

**Status:** Draft (pre-stable)
**Family:** `component`
**Schema:** `https://schemas.musher.dev/component/v1/component.schema.json`

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as
described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

> **This document is normative.** Where it disagrees with a `description` field
> in the JSON Schema, this document wins. Schema descriptions are explanatory.

---

## <a id="scope"></a>1. Scope

A **Component Document** defines one reusable, versioned workload: where its
image comes from, how it runs, how its health is determined, and what
configuration it consumes and produces.

A Component Document does not describe a deployment. It is composed into a
[Blueprint Document](../../blueprint/v1/spec.md), which is what gets deployed.

**Out of scope for this document**

- Composition of multiple components → `blueprint` family
- Storefront presentation → `listing` family
- Runtime state, instances, and endpoints → the Musher API

## <a id="envelope"></a>2. Document envelope

Every Musher specification document shares one envelope:

```yaml
specVersion: v1
kind: COMPONENT
metadata: { … }
spec: { … }
```

| Field | Requirement |
|---|---|
| `specVersion` | REQUIRED. Declares the document-format compatibility family, independent of any API URL version. |
| `kind` | REQUIRED. MUST be `COMPONENT` for this family. |
| `metadata` | REQUIRED. Identity. |
| `spec` | REQUIRED. The definition itself. |

Unknown properties MUST be rejected with `ERR_UNKNOWN_FIELD` at every level, not
only at the root of the envelope. A misspelled field is an error, never a
silently ignored one — including when the misspelled field is optional, where
ignoring it would silently substitute the default.

A validator encountering a `specVersion` it does not support MUST reject the
document with `ERR_UNSUPPORTED_SPEC_VERSION` and MUST NOT attempt a best-effort
interpretation.

> **Note.** This envelope is deliberately not a Kubernetes-style
> `apiVersion: <group>/<version>`. `specVersion` is Musher's document-format
> discriminator and one convention beats two. See
> [ADR 0001](../../../docs/adr/0001-canonical-repository-architecture.md).

## <a id="compatibility"></a>3. Version compatibility

`specVersion: v1` declares a **compatibility family**, not an exact schema. A
validator MUST evaluate the document against the newest `v1.x.y` schema release
it holds.

Within a major version, validation MUST NOT become stricter. A document that
validated against `v1.0.0` MUST validate against every later `v1.x.y`.

> **TODO** — Specify the behaviour when a document uses a field introduced in a
> schema release newer than the validator holds. Expected shape: reject with
> `ERR_UNKNOWN_FIELD` and instruct the operator to update, rather than ignore.

## <a id="metadata"></a>4. Metadata

> **TODO** — Define `metadata.version` semantics: monotonicity requirements, the
> relationship to the containing item's version, and whether reuse of a version
> number with different content is an error.

## <a id="workload"></a>5. Workload

> **TODO** — Normative rules for each workload kind (`SERVICE`, `WORKER`,
> `JOB`, `CRON`), including which fields are meaningful for each. In particular:
> whether `endpoints` on a `WORKER`, or `schedule` on a `SERVICE`, is an error
> or ignored. Current schema permits both; that MUST be resolved before v1 is
> declared stable.

### <a id="source"></a>5.1 Source

> **TODO** — Image reference pinning rules. Floating tags (`latest`, `main`,
> `edge`) MUST be rejected; state the exact grammar and the diagnostic code.
> Define digest-pinned reference handling and Git ref resolution semantics.

### <a id="endpoints"></a>5.2 Endpoints

> **TODO** — Port range, protocol/visibility interaction, and whether more than
> one `PUBLIC` endpoint is permitted.

### <a id="env-vars"></a>5.3 Environment variables

> **TODO** — Key grammar, the precedence order between literal, config-reference,
> and contract-supplied values, and the handling of sensitive values.

### <a id="health"></a>5.4 Health probes

> **TODO** — Semantics of `startup`, `readiness`, and `liveness`; default
> values; and the meaning of a probe naming an endpoint that does not exist.

### <a id="volumes"></a>5.5 Volumes

> **TODO** — Mount path constraints (absolute, no traversal, no overlap between
> two volumes), size bounds, and access-mode semantics.

## <a id="contract"></a>6. Configuration contract

> **TODO** — The `inputs`/`outputs` contract is the load-bearing part of
> composition and needs the most precise prose. Cover: `suppliedBy` semantics,
> generator determinism, what makes an output referenceable by a blueprint
> connection, and type compatibility between an output and the input it feeds.

## <a id="validation-layers"></a>7. Validation layers

Structural validation is one layer of four. An implementation MUST apply them
in order and MUST NOT report a later-layer diagnostic before the earlier layers
pass.

| Phase | Enforces | Where it runs |
|---|---|---|
| `parser` | Strict YAML 1.2. Duplicate keys MUST be rejected. Anchors and aliases MUST be rejected. | Client and server |
| `structural` | This family's JSON Schema 2020-12 document. | Client and server |
| `semantic` | Rules JSON Schema cannot express — reference resolution, path containment, uniqueness across collections. | Client and server |
| `capability` | Account, region, and quota checks. | Server only |

A client MUST NOT require network access for the `parser`, `structural`, or
`semantic` phases.

## <a id="diagnostics"></a>8. Diagnostics

Diagnostic **codes** and the **phase** at which validation fails are normative.
Human-readable messages are not — implementations in different languages emit
different text and that is expected.

| Code | Phase | Meaning |
|---|---|---|
| `ERR_DUPLICATE_KEY` | `parser` | The same mapping key appears twice. |
| `ERR_UNSUPPORTED_SPEC_VERSION` | `structural` | `specVersion` is not a supported value. |
| `ERR_WRONG_KIND` | `structural` | `kind` does not match the family being validated. |
| `ERR_UNKNOWN_FIELD` | `structural` | A property not defined by the schema is present. |
| `ERR_MISSING_FIELD` | `structural` | A required property is absent. |
| `ERR_INVALID_TYPE` | `structural` | A value has the wrong type. |
| `ERR_INVALID_VALUE` | `structural` | A value violates a pattern, enum, or bound. |

> **TODO** — Extend with the semantic-phase codes once section 6 is written.
> The registry above is the complete set an implementation must handle today.

## <a id="conformance"></a>9. Conformance

An implementation conforms to this specification when it produces the declared
outcome for every fixture in
[`conformance/component/v1/`](../../../conformance/component/v1/).

Implementations MUST run the fixture corpus in their own CI. Passing a fixture
that is declared to fail is a conformance failure.

## <a id="known-debt"></a>10. Known debt

This schema was seeded from the platform's Pydantic-generated catalog schema.
The following MUST be resolved before v1 is declared stable:

1. `$defs` names carry implementation affixes (`SeedComponentMetadata`,
   `ComponentSpecRequest`). Renaming is a breaking change to `$ref` targets and
   is scheduled deliberately, not incidentally.
2. Auto-generated `title` values are mangled (`Specversion`, `Builderimage`).
3. Every section above marked TODO is currently defined only by the schema's
   structure, which is not a substitute for prose.
