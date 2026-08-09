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

`spec.workload` says how the component runs. Its `kind` is the runtime shape,
and the shape decides which of the remaining fields carry meaning.

| Field | `SERVICE` | `WORKER` | `JOB` | `CRON` |
|---|---|---|---|---|
| `endpoints` | permitted | forbidden | forbidden | forbidden |
| `command` | permitted | permitted | REQUIRED | REQUIRED |
| `schedule` | forbidden | forbidden | forbidden | REQUIRED |
| `health.readiness` | see [§5.4](#health) | permitted | permitted | permitted |

`source`, `envVars`, and `volumes` are permitted on every kind. Every rule in
the table is decided in the `structural` phase.

**Forbidden means rejected, not ignored.** A forbidden field MAY be omitted, or
written in its own empty form — `endpoints: {}` for a mapping, `schedule: null`
for a nullable block. Anything else is an error, and the two empty forms are
not interchangeable: `endpoints` is a mapping and takes no null,
`schedule` is a nullable block and takes no empty mapping.
[§2](#envelope) has already settled why — a misspelled field is an error rather
than a silently ignored one, "including when the misspelled field is optional,
where ignoring it would silently substitute the default". A `schedule` on a
`SERVICE` fails for the same reason: an author who writes one believes their
service is scheduled, and accepting it silently is how that belief survives to
production.

**`command` is a different case from `schedule`.** A `JOB` and a `CRON` have
nothing to run without it, so it is REQUIRED on both. On a `SERVICE` or a
`WORKER` it overrides the image's default command, which is meaningful rather
than meaningless, so it stays permitted.

**A `SERVICE` MAY declare no endpoint.** The smallest component that validates
is a service running a pinned image and nothing else. A service exposing no
endpoint and a worker are operationally much the same thing, so requiring at
least one endpoint is a defensible rule. It is simply not this version's rule,
and adopting it later rejects documents v1 accepts.

Input and output keys are unique within a component because `contract.inputs`
and `contract.outputs` are mappings. A repeated key is `ERR_DUPLICATE_KEY` in
the `parser` phase, before any rule in this section is considered.

### <a id="source"></a>5.1 Source

`source` is discriminated on `type`.

**`IMAGE`.** `ref` is REQUIRED and names a prebuilt OCI image. There is no
`build` on this branch — a prebuilt image is not built again, and the field is
absent rather than ignored so it cannot be misread as an override.

**`GIT`.** `repositoryUrl` and `build` are both REQUIRED. `ref` is OPTIONAL and
pins a branch or a commit; omitting it takes the repository's default branch. A
`BRANCH` ref resolves at build time, so two builds of one unchanged document
can produce different images. A `COMMIT` ref is reproducible. Neither is
rejected, but a component that must build reproducibly SHOULD pin a commit.

**Image references MUST be pinned.** An unpinned reference mutates under
whoever curates the registry, shifting a deployment with no change to any
document in the item. Two layers enforce it, and the split between them is
deliberate.

A reference MUST carry a tag or a digest. A bare name — an implicit `:latest` —
is rejected in the `structural` phase with `ERR_INVALID_VALUE`. That is a
grammar, so the schema carries it.

A reference MUST NOT carry a floating tag. The floating set is `latest`,
`main`, `main-stable`, `master`, `stable`, `edge`, `nightly`, `dev`, and
`rolling`, compared case-insensitively; a reference whose tag is one of them is
rejected in the `semantic` phase with `ERR_UNPINNED_IMAGE`.

**Why the floating set is not a `pattern`.** It is a curated list and it will
grow. Growing a `pattern` makes a previously valid document invalid, which is a
major version. Held as a `semantic` rule instead, the list can be extended in a
minor release — the grammar above is fixed and belongs in the schema, the
blocklist is not and does not.

A digest pin — `@sha256:` followed by 64 lowercase hexadecimal digits —
satisfies both rules whatever tag accompanies it, because the digest is what
resolves. The floating-tag rule applies only to a reference carrying no digest.

### <a id="endpoints"></a>5.2 Endpoints

> **TODO** — Port range, protocol/visibility interaction, and whether more than
> one `PUBLIC` endpoint is permitted.

### <a id="env-vars"></a>5.3 Environment variables

> **TODO** — Key grammar, the precedence order between literal, config-reference,
> and contract-supplied values, and the handling of sensitive values.

### <a id="health"></a>5.4 Health probes

Three staged probes. Each is OPTIONAL unless the rule below applies, and each
polls an HTTP path.

| Probe | Gate | Consequence of failure |
|---|---|---|
| `startup` | Initialisation | The workload counts as not yet started. |
| `readiness` | Traffic | The replica leaves routing; it is not restarted. |
| `liveness` | Aliveness | The container is restarted. |

`path` is the only REQUIRED property of a probe. The rest default:
`initialDelaySeconds: 10`, `periodSeconds: 10`, `timeoutSeconds: 5`,
`successThreshold: 1`, `failureThreshold: 3`.

`endpoint` names the endpoint whose port the probe targets; null selects the
primary endpoint. A probe naming an endpoint the workload does not declare is
rejected in the `semantic` phase with `ERR_UNKNOWN_ENDPOINT`. The schema cannot
express it — the endpoint names are mapping keys elsewhere in the document, and
JSON Schema cannot constrain a value against a sibling's keys.

**`readiness` is REQUIRED for a `SERVICE` exposing at least one `PUBLIC`
endpoint**, and OPTIONAL everywhere else, including on a `SERVICE` whose
endpoints are all `PRIVATE`. The rule is narrow on purpose. Without a readiness
gate a public URL routes to a replica that is running but not yet serving, and
the first request a user makes is the one that fails. A private consumer inside
the mesh retries; a browser does not.

### <a id="volumes"></a>5.5 Volumes

`volumes` is a mapping from volume name to a declaration. `sizeGib` and
`mountPath` are REQUIRED. `accessMode` (default `READ_WRITE_ONCE`) and
`isReadOnly` (default `false`) are OPTIONAL.

`mountPath` MUST be absolute. A relative path is rejected in the `structural`
phase with `ERR_INVALID_VALUE`.

`accessMode` decides how the materialised volume is shared across replicas.
`READ_WRITE_ONCE` is an attached block volume and mounts on a single replica;
`READ_WRITE_MANY` is a shared network volume and mounts on every replica.

**What v1 does not constrain.** Two volumes on one workload MAY declare
overlapping mount paths, and `sizeGib` has no lower or upper bound. Neither
silence is a considered permission — both are gaps, in this specification and
in the implementations reading it, and they are recorded here rather than
described aspirationally so that a reader can tell which silences are
decisions. Closing either one rejects documents that validate today and is
therefore a breaking change.

## <a id="contract"></a>6. Configuration contract

`spec.contract` is what makes a component composable. `inputs` are values the
component needs; `outputs` are values it publishes for another component to
consume. A [Blueprint](../../blueprint/v1/spec.md) connection joins one node's
output to another node's input, and this section defines both ends of that
join.

`contract` is OPTIONAL. A component that neither consumes nor publishes
configuration omits it.

### <a id="inputs"></a>6.1 Inputs

`schema` is the only REQUIRED property of an input. `suppliedBy` decides who
satisfies it and defaults to `USER`.

| `suppliedBy` | Satisfied by | `ui` |
|---|---|---|
| `USER` | The deploying user, through the install form. | REQUIRED |
| `CONNECTION` | A blueprint connection, from an upstream output. | MUST be null |

A `USER` input needs a label before a form can render it. A `CONNECTION` input
never reaches the install form, so presentation metadata on one is a statement
about a form it will never appear on. Both rules are `structural`.

**A generated input is secret material.** An input carrying `generator` — one
whose value the platform mints at deploy time — MUST declare `suppliedBy: USER`
and `schema.isSensitive: true`. Both MUST be written explicitly rather than
left to a default: `isSensitive` defaults to `false`, and a generated value not
marked sensitive is echoed back into logs and interfaces. The value rides on a
`USER` input because that is the slot the install form already reserves for it
— the user simply does not have to type it.

### <a id="outputs"></a>6.2 Outputs

`schema` and `valueFrom` are REQUIRED.

| `valueFrom` | `value` | Where the value comes from |
|---|---|---|
| `DECLARED` | REQUIRED, non-empty | This document. |
| `DERIVED` | MUST be null | The platform, from the running workload. |

**An output depends on its own node and nothing else.** A `DECLARED` output's
value is written in this document. A `DERIVED` output's value comes from the
producing workload's own addressing — its private address, its public URL. An
output MUST NOT depend on a value the component received over an inbound
connection.

That constraint is what makes an output referenceable at all: a consumer can
read a producer's output without the producer having first been told anything.
It is not, however, a licence for a cyclic graph.
[Blueprint §4.2](../../blueprint/v1/spec.md#connections) requires the
connection graph to be acyclic, for reasons of its own.

> **TODO** — Type compatibility between an output and the input it feeds.
> `schema.semanticType` is the tag a composition layer matches on, but the
> matching rule is not yet stated. It belongs with
> [blueprint §4.2](../../blueprint/v1/spec.md#connections), which resolves the
> connection.

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
| `ERR_UNPINNED_IMAGE` | `semantic` | An image reference carries a floating tag. |
| `ERR_UNKNOWN_ENDPOINT` | `semantic` | A probe names an endpoint the workload does not declare. |

The rows above the `semantic` pair are the shared envelope registry: the
[blueprint](../../blueprint/v1/spec.md#diagnostics) and
[listing](../../listing/v1/spec.md#diagnostics) families declare themselves
additions to this table rather than restating it. The two `semantic` codes are
this family's own.

## <a id="conformance"></a>9. Conformance

An implementation conforms to this specification when it produces the declared
outcome for every fixture in
[`conformance/component/v1/`](../../../conformance/component/v1/).

Implementations MUST run the fixture corpus in their own CI. Passing a fixture
that is declared to fail is a conformance failure.

## <a id="known-debt"></a>10. Known debt

This schema was seeded from the platform's Pydantic-generated catalog schema.
The naming that arrived with it — `$defs` keys carrying `Seed…`/`…Request`
affixes, and generated `title` values like `Specversion` — has been cleaned,
and `tools/src/lint.ts` now rejects both. The remaining debt MUST be resolved
before v1 is declared stable:

1. Every section above marked TODO is currently defined only by the schema's
   structure, which is not a substitute for prose.
