# Musher Component Document — Specification v1

**Status:** Draft (pre-stable)
**Family:** `component`
**Schema:** `https://schemas.musher.dev/component/v1/component.schema.json`

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
ignoring it would silently substitute the default. A property that *is* defined,
by a schema release the validator does not hold, is the same error for a reason
[§3](#compatibility) gives.

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

**A validator holding an older release than the document was written against
MUST reject it.** A field introduced in `v1.3.0` is, to a validator holding
`v1.1.0`, a property the schema does not define, and it is rejected in the
`structural` phase with `ERR_UNKNOWN_FIELD` like any other. A validator MUST NOT
ignore, strip, or pass through a property it cannot evaluate, and MUST NOT relax
the rule on a claim that the property is new — no such claim is verifiable.

**The code is `ERR_UNKNOWN_FIELD` because the validator cannot tell the two
cases apart.** `specVersion` names the family, not the release, so nothing in
the document says which release it was written against. A field from a later
release and a misspelling are the same bytes to a validator that holds neither
definition. A code that said so — `ERR_SCHEMA_TOO_OLD` — would require the
validator to know what it is missing, which is precisely what it does not have.

**Guessing is the failure [§2](#envelope) exists to prevent.** Ignoring a
misspelled optional field silently substitutes the default; a field from a newer
release is that hazard with a worse ending. The author wrote it, the schema
defining it exists, and the only party who cannot see it is the validator. A
document rejected for a field the operator can look up is recoverable. A
document accepted with that field dropped is not.

Because the diagnostic cannot name the cause, the implementation is where an
operator has to find it. An implementation SHOULD make the schema release it
evaluated against discoverable — in the diagnostic, in a `--version`-style
output, or both — and SHOULD name updating the validator among the remedies.
Message text is not normative ([§8](#diagnostics)), so this is a recommendation
about what an implementation surfaces, not about the words it chooses.

**Why the release is not pinned in the document.** Letting `specVersion` carry
`v1.3.0` would turn this failure into `ERR_UNSUPPORTED_SPEC_VERSION`, which
names the cause exactly. That alternative is still rejected. `specVersion` is
the document-format discriminator and declaring a family is the whole of its
job ([§2](#envelope)); pinning a release there asks every author to name a
floor they have no way to know, and makes a document that would validate
everywhere fail against the releases it never needed.

**The guarantee runs one way.** An old document validates against a new
validator; a new document does not validate against an old one. A field added in
`v1.N.0` is therefore usable only where the consumer holds `v1.N.0` or later,
and a document that must validate everywhere is written against the oldest
release its consumers hold.

## <a id="metadata"></a>4. Metadata

`metadata` carries `version` and nothing else. A component document has no
`slug`. A [blueprint](../../blueprint/v1/spec.md#identity) and its listing each
name the item they are two halves of; a component is not the item, and the name
it answers to is the stem of the file that holds it — which is what a repo-local
reference spells out in full
([blueprint §4.1](../../blueprint/v1/spec.md#component-reference)). Any other
property is `ERR_UNKNOWN_FIELD`, as [§2](#envelope) requires at every level.

`version` is an integer, 1 or greater. It is REQUIRED and never defaulted, so
what a node deploys is a function of this file alone.

**The version names a position in one component's lineage.** It is not a SemVer
triple and carries no compatibility meaning: nothing is derivable from the
distance between 2 and 7, and nothing is promised about how one version behaves
against another. It orders, and that is the whole of its job.

**Two reference forms pin it, and only one writes it down.**

| Reference form | What pins the version |
|---|---|
| Repo-local | The referenced document's own `metadata.version`. `componentVersion` MUST NOT be present. |
| Published | `componentVersion` on the node. |

**A version is used once.** Each publication of a component MUST carry a version
strictly greater than the highest already published for that component. Gaps are
permitted — 1 to 7 is a release and not an error — but a version that does not
increase is rejected in the `capability` phase with `ERR_VERSION_NOT_MONOTONIC`.

Reuse is the case the rule exists for. `componentVersion: 3` on a published node
is the whole of what that node deploys, and a registry that let 3 mean two
different documents would make the pin name nothing. The repo-local form has the
same problem one step removed: a blueprint that deployed version 3 last month
and version 3 today, with different bytes behind it, has no way to say so.

**Why the phase is `capability`.** Deciding the rule needs to know what was
published before, which needs the catalog, which needs the network — and
[§7](#validation-layers) forbids the `parser`, `structural` and `semantic`
phases from requiring it. A client validating a file it has just written cannot
see the lineage and MUST NOT report this rule. Offline validation is therefore
exactly as strict as it was.

Whether a registry treats an identical re-submission as a no-op rather than as a
publication is outside this contract. This document orders publications; it does
not define when two YAML files are the same document.

**The version is not the item's version.**
[Blueprint §3](../../blueprint/v1/spec.md#identity) pins a blueprint to its
sibling listing, and neither is pinned to any component beneath it. The two
numbers count different things: an item's version counts releases of the item, a
component's counts releases of the component, and in the published form one
component is deployed by many items at once.

A release of a component an item deploys SHOULD be accompanied by a release of
the item, because the listing describes what would be installed and a component
that has moved makes that description stale. It is a SHOULD and carries no
diagnostic: the disagreement is visible only across two revisions, and a
validator is handed one.

**What v1 does not constrain.** Nothing orders one component's versions against
another's — two components in the same item sitting at 4 and 11 mean nothing
worth reading into. Nothing checks a version offline at all: `minimum: 1` is the
whole of the `structural` rule, and every other statement in this section is
either `capability` or a SHOULD.

## <a id="workload"></a>5. Workload

`spec.workload` says how the component runs. Its `kind` is the runtime shape,
and the shape decides which of the remaining fields carry meaning.

| Field | `SERVICE` | `WORKER` | `JOB` | `CRON` |
|---|---|---|---|---|
| `endpoints` | REQUIRED, ≥ 1 | forbidden | forbidden | forbidden |
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

**A `SERVICE` MUST declare at least one endpoint.** A service is the kind that
serves, and one exposing nothing is a `WORKER` under another name. Permitting
it would leave `kind` describing nothing: two documents would differ in the
word they use for a workload that runs identically, and a reader could not tell
from the `kind` whether anything could reach it.

Both spellings of "none" are rejected, and they carry different codes because
they read differently to an author. An absent `endpoints` block is
`ERR_MISSING_FIELD` — the author has not said how the service is reached. A
block written and left empty is `ERR_INVALID_VALUE` — the author has said, and
said nothing. Both are `structural`.

This is the one rule in this section where a workload that runs perfectly well
is refused. A container that listens on no port and is meant to stay up is a
real thing to want; it is a `WORKER`, and writing it as one costs an author a
single word.

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

`endpoints` is a mapping from endpoint name to one port the workload listens
on. `containerPort`, `protocol` and `visibility` are all REQUIRED — an endpoint
missing any of them describes a port nothing can route to. Only a `SERVICE` may
declare one; [§5](#workload) carries the rest of that rule.

**An endpoint name is a reference.** A name MUST match
`^[a-z][a-z0-9]{0,19}$` — lowercase alphanumeric, one to twenty characters —
and one that does not is rejected in the `structural` phase with
`ERR_INVALID_VALUE`. The name is not decoration: [§5.4](#health) points a probe
at one and [§6.1](#inputs) derives an address from one, so a dot or a space in
a name is a hazard rather than a matter of taste.

**The grammar is narrower than a slug, and deliberately.** A name does not
become a DNS label; it is composed *into* one, beside the other names that
identify the deployment. Two properties follow from that, and neither holds for
the slug grammar [blueprint §4.1](../../blueprint/v1/spec.md#component-reference)
uses:

1. **A separator has to survive.** Whatever character an implementation joins
   the parts with, a name drawn from the same alphabet as the parts it joins to
   cannot be delimited — with `-`, endpoint `api` on a component named `web` and
   a component named `api-web` compose to the same label. Doubling the separator
   only helps if neither side may contain the doubled form, which a
   hyphen-bearing grammar permits. Alphanumeric makes any hyphen separator
   unambiguous by construction.
2. **The label budget is shared.** A DNS label holds 63 characters, and the
   endpoint name is one of several things inside it. A name permitted to reach
   62 leaves nothing for the rest, which forces every implementation into a
   truncation rule of its own — and truncation reintroduces exactly the
   collisions the grammar was meant to prevent. Twenty characters leave at least
   forty for everything else.

Twenty characters also fit every name worth having — `web`, `api`, `grpc`,
`metrics`, `console`, `admin`. A name that does not fit is describing something
an endpoint name should not be describing.

**`containerPort` is an integer from 1 to 65535.** Outside that range there is
no port to bind. The bound is `structural` and carries `ERR_INVALID_VALUE`.

A port below 1024 SHOULD NOT be used. Binding one needs a capability the runtime
grants to the container, and a workload that does not hold it fails at deploy
time with nothing in the document to blame. It stays advice rather than a
rejection because whether that grant exists is a fact about the runtime this
document cannot see, and a rule that rejects on a fact it cannot check is
guessing. Making it a MUST later rejects documents v1 accepts, and is therefore
breaking.

**Every protocol may be `PUBLIC`, and the address form is what differs.**
`visibility: PUBLIC` publishes the endpoint at an externally reachable address.
Which kind of address depends on the protocol, and the distinction is what the
two rules below turn on:

| `protocol` | What a `PUBLIC` endpoint publishes |
|---|---|
| `HTTP`, `HTTPS`, `WS`, `GRPC` | A **URL**, on a hostname derived from the endpoint name. |
| `TCP`, `UDP` | A **`host:port` address**, on a port allocated from the edge. |

Nothing here is `structural`: a `PUBLIC` `TCP` endpoint is a database, a game
server, an MQTT broker or an SMTP relay exposed to the internet, and rejecting
it would make a working capability inexpressible. What the split does decide is
which references may name such an endpoint. [§5.4](#health)'s probe reads a URL
and may name only the first row. [§6.1](#inputs)'s platform default reads
either, and each of its four sources is tied to the row it takes its value
from.

**A component MAY declare more than one `PUBLIC` endpoint**, and each one
publishes its own address. A component fronting an API on one port and a console
on another is one component rather than two, and nothing about routing the
second is harder than routing the first.

The consequence is a rule and not a caveat: **anything naming a public address
MUST name the endpoint it means.** Where two exist there is no such thing as
"the component's URL". [§6.1](#inputs) is where that bites, and where the
selector lives.

**The primary endpoint.** A reference MAY omit the endpoint it targets — a
probe's `endpoint` and a platform default's both admit null — and the primary
endpoint is what null selects. It is:

1. the workload's sole endpoint, where it declares exactly one; failing that
2. its sole `PUBLIC` endpoint, where it declares exactly one; failing that
3. nothing.

Where it is nothing, a reference that omits the endpoint is rejected in the
`semantic` phase with `ERR_AMBIGUOUS_ENDPOINT`. The schema cannot express this
for the reason [§5.4](#health) gives: the endpoint names are mapping keys
elsewhere in the document.

"Nothing" is reached two ways and both are rejected, though they read
differently to an author. A workload declaring several candidates has too many
and must choose. A workload declaring no endpoint at all has none, and a probe
on it polls a port that does not exist. [§5](#workload) puts the second beyond
a `SERVICE`, which MUST declare at least one endpoint — but the other three
kinds declare none and may still carry a probe, so the case survives there.

**Why that is an error rather than a tiebreak.** Electing the first name in sort
order would give every document an answer, and would let a new endpoint called
`api` silently re-point a probe that has worked for a year. A rule that changes
what an unedited line means is the failure [§2](#envelope) rejects a misspelled
optional field to avoid.

**What v1 does not constrain.** Two endpoints MAY declare the same
`containerPort`, and nothing says which of them anything routing to that port
should believe. That silence is a gap rather than a considered permission, and
is recorded here so a reader can tell the two apart. Closing it rejects
documents that validate today.

The edge address of a `PUBLIC` `TCP` or `UDP` endpoint **is** readable from the
contract. [§6.1](#inputs)'s `PUBLIC_ADDRESS` derives the whole `host:port` and
`PUBLIC_PORT` the allocated port alone, so a component whose sibling needs a
broker's or a database's edge address at install time can say so.

### <a id="env-vars"></a>5.3 Environment variables

`envVars` is a **sequence** of entries, each pairing a `key` with a `value`. It
is the one collection in this document that is not a mapping, and that shape
decides more than it looks like it should — [§5](#workload)'s argument that
"input and output keys are unique within a component because `contract.inputs`
and `contract.outputs` are mappings" does not reach here. A repeated env-var key
is not `ERR_DUPLICATE_KEY` in the `parser` phase, because at the YAML level
nothing is repeated: two entries of a sequence are two entries.

**A key MUST match `^[A-Z_][A-Z0-9_]*$`** and be 1 to 128 characters. That is
the POSIX shape, and it is REQUIRED rather than conventional: a name outside it
is not portably settable by the thing that has to set it. The rule is
`structural` and carries `ERR_INVALID_VALUE`.

`value` is discriminated on `type`.

| `type` | Carries | What the document holds |
|---|---|---|
| `LITERAL` | `value`, and OPTIONAL `isSensitive` | The value itself. An empty string is permitted. |
| `CONFIG_REF` | `configKey` | A reference. The document never holds the value. |

**A key is declared once.** Two entries sharing a key are rejected in the
`semantic` phase with `ERR_DUPLICATE_ENV_KEY`, anchored at the **later** of the
two — the first declaration is the one that stands, so the second is the one an
author has to change. Without this rule the sequence shape would make a repeated
key mean whatever an implementation's last write happened to be.

**A key is claimed by one declaration.** An input's
[`target.envVarKey`](#inputs) binds a resolved value into the environment, so it
competes for the same namespace these entries do. Two declarations of one key
are rejected in the `semantic` phase with `ERR_CONFLICTING_ENV_KEY`, in both
shapes it can take:

- an `envVars` entry whose `key` equals some input's `target.envVarKey`, and
- two inputs declaring the same `target.envVarKey`.

The diagnostic anchors at an input's `target/envVarKey` in both cases, and where
two inputs collide it anchors at the later of the two in **lexicographic
input-name order**. Anchors are normative ([§8](#diagnostics)), so the tiebreak
is written down rather than left to whichever order an implementation iterates
a mapping in.

**There is no precedence order**, and there is nothing for one to resolve: a
collision is an error, so no key is ever claimed twice. Ranking the two instead
— letting a contract-supplied value quietly outrank a literal, or the reverse —
would settle the ambiguity without telling anyone there was one, and the
consequence would surface as a wrong value inside a running workload rather than
as a diagnostic. [Blueprint §5.2](../../blueprint/v1/spec.md#merge) refused that
same trade for input merging, and refused it on the same ground.

**Sensitivity.** `isSensitive` on a `LITERAL` marks the value as secret
material. An implementation MUST treat a marked value as
[§6.1](#inputs) requires of a generated input: masked in read surfaces, and
never echoed back into logs, diagnostics, or interfaces. It defaults to `false`,
so an unmarked literal is handled as ordinary configuration.

A `CONFIG_REF` carries no marking and needs none. It names a value resolved
elsewhere and the document holds only the name, so there is nothing in this file
to mask.

A component SHOULD carry secret material as a `CONFIG_REF`, or as an input with
a `generator` ([§6.1](#inputs)), rather than as a marked literal. `isSensitive`
governs how a value is *handled*; it does not stop the value being bytes in a
file that is read, reviewed, and committed. It is a SHOULD because a marked
literal is still better than an unmarked one, and this document cannot see where
the file lives.

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
primary endpoint [§5.2](#endpoints) elects, and is rejected with
`ERR_AMBIGUOUS_ENDPOINT` where that section elects none. A probe naming an
endpoint the workload does not declare is rejected with `ERR_UNKNOWN_ENDPOINT`.
Both are `semantic`, and the schema can express neither — the endpoint names are
mapping keys elsewhere in the document, and JSON Schema cannot constrain a value
against a sibling's keys.

**A probe MUST name an endpoint in the HTTP family.** Every probe polls an HTTP
path, so an endpoint whose `protocol` is `TCP` or `UDP` has nothing for one to
poll. A probe resolving to such an endpoint — by naming it, or by having the
primary election select it — is rejected in the `semantic` phase with
`ERR_ENDPOINT_NOT_HTTP`. The rule is `semantic` for the same reason as the two
above it.

**`readiness` is REQUIRED for a `SERVICE` exposing at least one `PUBLIC`
endpoint whose `protocol` is `HTTP`, `HTTPS`, `WS` or `GRPC`**, and OPTIONAL
everywhere else — including on a `SERVICE` whose endpoints are all `PRIVATE`,
and on one whose only `PUBLIC` endpoint is `TCP` or `UDP`. The rule is narrow on
purpose. Without a readiness gate a public URL routes to a replica that is
running but not yet serving, and the first request a user makes is the one that
fails. A private consumer inside the mesh retries; a browser does not.

The `TCP`/`UDP` exemption is that same argument, not a second one. What
[§5.2](#endpoints) publishes for those protocols is a `host:port` address, and
an L4 consumer connecting to one retries exactly as a private consumer does.
Compelling a probe there would also compel an HTTP path against a port that
speaks no HTTP — a rule the document has no way to satisfy.

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

**A platform default derives the value from the component's own addressing.**
`platformDefault` is OPTIONAL and null by default. Where it is present, `source`
is REQUIRED and selects what is derived, and `endpoint` names which endpoint it
is derived from.

There are four sources, and they come in two pairs because
[§5.2](#endpoints) gives a `PUBLIC` endpoint two address forms:

| `source` | Derives | From an endpoint publishing |
|---|---|---|
| `PUBLIC_URL` | The full URL. | a **URL** — `HTTP`, `HTTPS`, `WS`, `GRPC` |
| `PUBLIC_HOSTNAME` | The host part of that URL. | " |
| `PUBLIC_ADDRESS` | The full `host:port`. | a **`host:port`** — `TCP`, `UDP` |
| `PUBLIC_PORT` | The allocated edge port alone. | " |

Each pair reads one address form. `PUBLIC_PORT` and `PUBLIC_HOSTNAME` exist
beside the whole they are part of because a consumer that takes host and port
as separate settings should not have to split a string this contract had
already composed.

`endpoint` is null by default and selects the primary endpoint
[§5.2](#endpoints) elects. Since a component MAY expose several `PUBLIC`
endpoints, one that does MUST name the endpoint here: null elects nothing there
and is rejected with `ERR_AMBIGUOUS_ENDPOINT`.

Three further rules follow the name, all `semantic`. An endpoint the workload
does not declare is `ERR_UNKNOWN_ENDPOINT` — the same code and the same reason
as a probe's. An endpoint that is declared but `PRIVATE` is
`ERR_ENDPOINT_NOT_PUBLIC`: every source derives an externally reachable
address, and a `PRIVATE` endpoint has none to give.

The third is the pairing above, enforced. **A source MUST name an endpoint
publishing the address form it reads.** A `URL` source naming a `TCP` or `UDP`
endpoint is `ERR_ENDPOINT_NOT_HTTP`, the same code a probe on such an endpoint
carries. A `host:port` source naming an `HTTP`-family endpoint is
`ERR_ENDPOINT_NOT_L4`. Two codes rather than one so a diagnostic names the axis
that failed, which is the same reason [blueprint §4.2](../../blueprint/v1/spec.md#connections)
splits its two compatibility codes.

**Why an HTTP-family endpoint does not answer `PUBLIC_ADDRESS`.** It is
reachable at a host and a port like anything else, so admitting it would be
easy and is refused deliberately. Such an endpoint is published through the
shared ingress rather than on a port allocated to it, so what the derivation
would yield is the ingress address on the ingress port — true, and not the
thing an author asking for an edge address is asking for. They want the port
their broker was given. A source that returns a defensible value nobody wanted
is worse than one that rejects the document, because the first failure is
silent and arrives at runtime.

Both rules apply to the endpoint a reference *resolves to*, elected or named,
for the reason [§5.2](#endpoints) gives: the primary is what null selects, so a
rule about the endpoint a reference means reaches it equally.

**A platform default is not a `CONNECTION`.** The value comes from the
component's own workload, never from an upstream node, which is the same line
[§6.2](#outputs) draws around an output. `suppliedBy` is unconstrained by
`platformDefault` in v1 — a gap, recorded rather than described as a decision.

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
It is also what lets two components consume each other.
[Blueprint §4.2](../../blueprint/v1/spec.md#connections) permits a cyclic
connection graph, and this rule is why it can: every output in a composition is
resolvable before any connection is bound, so a cycle among the connections
leaves nothing unresolved.

**Where an output must fit the input it feeds.** An output's `schema` and the
`schema` of the input it is wired to must agree on `type`, and on
`semanticType` wherever the consuming input names one.
[Blueprint §4.2](../../blueprint/v1/spec.md#connections) states the rule and
carries the two diagnostics, because the connection is what joins the two ends
and a component document sees only one of them.

## <a id="validation-layers"></a>7. Validation layers

Structural validation is one layer of four. An implementation MUST apply them
in order and MUST NOT report a later-layer diagnostic before the earlier layers
pass.

| Phase | Enforces | Where it runs |
|---|---|---|
| `parser` | The Musher YAML profile — [§7.1](#yaml-profile). | Client and server |
| `structural` | This family's JSON Schema 2020-12 document. | Client and server |
| `semantic` | Rules JSON Schema cannot express — reference resolution, path containment, uniqueness across collections. | Client and server |
| `capability` | Account, region, and quota checks. | Server only |

A client MUST NOT require network access for the `parser`, `structural`, or
`semantic` phases.

**Why the `parser` phase rejects legal YAML.** A duplicate key, an anchor and
an alias are all well-formed YAML 1.2, and all three are rejected here.

A duplicate key has no defined winner: parsers disagree on whether the first or
the last survives, so a document carrying one means two things. An alias means
one thing, but only after expansion, and a document whose meaning depends on
being expanded is not readable as the thing it declares — the same reason
[§2](#envelope) rejects a misspelled optional field rather than ignoring it. An
anchor with no alias is inert, and is rejected anyway: an author who writes one
is reaching for a feature this contract does not have, and finding that out at
authoring time is better than finding it out when the alias is added.

The bound also matters. Alias expansion is where a small document becomes a
large one — the billion-laughs shape — and a validator that must expand before
it can measure has no way to refuse cheaply.

`ERR_ANCHOR_OR_ALIAS` is separate from `ERR_INVALID_YAML` because the two say
different things to an author. One means the document is malformed; the other
means it is well-formed and uses something this contract withholds.

### <a id="yaml-profile"></a>7.1 The Musher YAML profile

Musher documents are written in a **restricted profile of
[YAML 1.2.2](https://yaml.org/spec/1.2.2/)**, not in unrestricted YAML. This
section is that profile, and it governs all three families — the
[blueprint](../../blueprint/v1/spec.md) and [listing](../../listing/v1/spec.md)
specifications inherit it rather than restating it.

Every restriction below withholds something YAML 1.2.2 permits. The reason is
uniform, and it is the one [§2](#envelope) gives for rejecting a misspelled
optional field: a document that means different things to different readers, or
that cannot be judged without unbounded work, is not a contract. A feature is
therefore withheld when it is *legal but ambiguous*, not when it is merely
unusual.

**Encoding and framing**

| Rule | Diagnostic |
|---|---|
| A document MUST be encoded in UTF-8. Malformed UTF-8 is rejected. | `ERR_INVALID_YAML` |
| A document MAY begin with a UTF-8 byte order mark. It carries no meaning and MUST be ignored. | — |
| Line endings MAY be LF or CRLF, and carry no meaning. | — |
| A file MUST contain exactly one YAML document. The `---` and `...` markers MAY be present; a stream carrying more than one document is rejected. | `ERR_MULTIPLE_DOCUMENTS` |

A file holding two documents has no answer to "which one is the component",
and picking the first silently discards a thing the author wrote.

**Structure**

| Rule | Diagnostic |
|---|---|
| Every mapping key MUST be a string. A numeric, boolean, null, or complex key is rejected. | `ERR_NON_STRING_KEY` |
| A mapping key MUST NOT appear twice. | `ERR_DUPLICATE_KEY` |
| A document MUST NOT declare an anchor or an alias. | `ERR_ANCHOR_OR_ALIAS` |
| A document MUST NOT use a merge key (`<<`). | `ERR_MERGE_KEY` |
| A node MUST NOT carry an explicit tag — neither a custom tag (`!secret`) nor a core-schema tag (`!!str`). | `ERR_EXPLICIT_TAG` |

Mapping keys are property names in every schema this repository publishes, and
`1:` resolving to the integer one on one parser and the string `"1"` on another
is the duplicate-key problem wearing a different hat.

A merge key is an alias by another name and is withheld for the same reason.
It is named separately because `<<` reads as a key rather than as a reference,
so an author who writes one is not told about aliases; they are told about `<<`.

An explicit tag overrides scalar resolution, and scalar resolution is exactly
what this profile fixes below. `!!str 5` and `5` differ only in a tag, and a
contract in which the type of a value depends on an annotation beside it has no
stable reading.

**Scalar resolution**

Scalars resolve by the **YAML 1.2 core schema**, and by nothing else. `true`
and `false` are booleans; `null` and `~` are null; `on`, `off`, `yes`, and `no`
are strings, as YAML 1.2 requires and YAML 1.1 did not. A value whose intended
type is not the resolved one MUST be quoted.

This is the one place where naming the version does real work: a YAML 1.1
parser reads `no` as boolean false, and a `country: no` in a document read by
both is two different documents.

**Bounds**

An implementation MUST reject a document exceeding any of these, and MUST accept
one that does not:

| Bound | Limit | Diagnostic |
|---|---|---|
| Document size | 1 MiB (1 048 576 bytes) | `ERR_DOCUMENT_TOO_LARGE` |
| Nesting depth | 64 levels | `ERR_DEPTH_EXCEEDED` |
| Scalar length | 64 KiB (65 536 bytes) | `ERR_SCALAR_TOO_LONG` |

The bounds are stated rather than left to implementations because "be sensible"
is not a bound: a document one validator accepts and another refuses on size is
not one contract, and an author has no way to discover the limit except by
exceeding it somewhere.

Each is far above any document a person writes and far below what makes a
parser a denial-of-service surface. Document size MUST be measured before
parsing — a limit a parser can apply only after building the tree is not a limit
on the work it does. The alias ban already removes the billion-laughs shape;
these bound the cases it does not cover.

**What carries no meaning**

Key order, comments, indentation width, quoting style, and flow-versus-block
form are all presentation. Two documents differing only in these are the same
document, and an implementation MUST NOT derive meaning from any of them.

Because YAML 1.2 is a superset of JSON, a document written as JSON is a valid
Musher document and is read identically.

## <a id="diagnostics"></a>8. Diagnostics

Diagnostic **codes** and the **phase** at which validation fails are normative.
Human-readable messages are not — implementations in different languages emit
different text and that is expected.

| Code | Phase | Meaning |
|---|---|---|
| `ERR_INVALID_YAML` | `parser` | The document is not well-formed YAML 1.2, or is not valid UTF-8. |
| `ERR_DUPLICATE_KEY` | `parser` | The same mapping key appears twice. |
| `ERR_ANCHOR_OR_ALIAS` | `parser` | The document declares a YAML anchor or an alias. |
| `ERR_MULTIPLE_DOCUMENTS` | `parser` | The file carries more than one YAML document. |
| `ERR_NON_STRING_KEY` | `parser` | A mapping key is not a string. |
| `ERR_MERGE_KEY` | `parser` | The document uses a merge key (`<<`). |
| `ERR_EXPLICIT_TAG` | `parser` | A node carries an explicit YAML tag. |
| `ERR_DOCUMENT_TOO_LARGE` | `parser` | The document exceeds the size bound in [§7.1](#yaml-profile). |
| `ERR_DEPTH_EXCEEDED` | `parser` | The document nests deeper than [§7.1](#yaml-profile) permits. |
| `ERR_SCALAR_TOO_LONG` | `parser` | A scalar exceeds the length bound in [§7.1](#yaml-profile). |
| `ERR_UNSUPPORTED_SPEC_VERSION` | `structural` | `specVersion` is not a supported value. |
| `ERR_WRONG_KIND` | `structural` | `kind` does not match the family being validated. |
| `ERR_UNKNOWN_FIELD` | `structural` | A property not defined by the schema is present. |
| `ERR_MISSING_FIELD` | `structural` | A required property is absent. |
| `ERR_INVALID_TYPE` | `structural` | A value has the wrong type. |
| `ERR_INVALID_VALUE` | `structural` | A value violates a pattern, enum, or bound. |
| `ERR_UNPINNED_IMAGE` | `semantic` | An image reference carries a floating tag. |
| `ERR_DUPLICATE_ENV_KEY` | `semantic` | Two `envVars` entries declare the same key. |
| `ERR_CONFLICTING_ENV_KEY` | `semantic` | An environment-variable key is claimed by more than one declaration. |
| `ERR_UNKNOWN_ENDPOINT` | `semantic` | A probe or a platform default names an endpoint the workload does not declare. |
| `ERR_AMBIGUOUS_ENDPOINT` | `semantic` | A reference omits the endpoint, and the workload elects no primary. |
| `ERR_ENDPOINT_NOT_PUBLIC` | `semantic` | A platform default deriving a public address names a `PRIVATE` endpoint. |
| `ERR_ENDPOINT_NOT_HTTP` | `semantic` | A probe, or a platform default deriving from a URL, resolves to an endpoint whose protocol is not in the HTTP family. |
| `ERR_ENDPOINT_NOT_L4` | `semantic` | A platform default deriving an edge address resolves to an endpoint whose protocol is in the HTTP family. |
| `ERR_VERSION_NOT_MONOTONIC` | `capability` | A published component version is not greater than the lineage's current version. |

The `parser` and `structural` rows are the shared envelope registry: the
[blueprint](../../blueprint/v1/spec.md#diagnostics) and
[listing](../../listing/v1/spec.md#diagnostics) families declare themselves
additions to this table rather than restating it. The `semantic` and
`capability` rows are this family's own.

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
and `tools/src/lint.ts` now rejects both. No section of this document is marked
TODO any longer: every rule it states is stated in prose, and the schema
implements the prose rather than standing in for it.

One debt remains, and it MUST be resolved before v1 is declared stable. Some
schema `description` fields still speak the platform's vocabulary rather than
this contract's — "resolved server-side at snapshot compute" names a pipeline
stage a reader outside `musher-dev/platform` cannot look up. Descriptions are
explanatory rather than normative, so nothing in this document turns on them; a
reader who cannot resolve the words is still being told to go somewhere they
cannot reach.

The Compute Profile half of that debt is closed.
[Blueprint §4.3](../../blueprint/v1/spec.md#node-compute) now carries the slug
grammar and names where the offered profiles are published, so a slug like
`general.standard.small` resolves for a reader outside the platform.
[ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) records
the rule that decided it.
