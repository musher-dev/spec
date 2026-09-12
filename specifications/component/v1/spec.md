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

A **Component Document** defines one reusable, versioned graph node: either a
workload this platform runs — where its image comes from, how it runs, how its
health is determined — or one it does not, addressed elsewhere. Both kinds say
what configuration they consume and produce.

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

| ID | Field | Requirement |
|---|---|---|
| <a id="COMP-ENV-001"></a>`COMP-ENV-001` | `specVersion` | REQUIRED. Declares the document-format compatibility family, independent of any API URL version. |
| <a id="COMP-ENV-002"></a>`COMP-ENV-002` | `kind` | REQUIRED. MUST be `COMPONENT` for this family. |
| <a id="COMP-ENV-003"></a>`COMP-ENV-003` | `metadata` | REQUIRED. Identity. |
| <a id="COMP-ENV-004"></a>`COMP-ENV-004` | `spec` | REQUIRED. The definition itself. |

<a id="COMP-ENV-005"></a>**`COMP-ENV-005`** — Unknown properties MUST be
rejected with `ERR_UNKNOWN_FIELD` at every level, not only at the root of the
envelope. A misspelled field is an error, never a silently ignored one —
including when the misspelled field is optional, where ignoring it would
silently substitute the default. A property that *is* defined, by a schema
release the validator does not hold, is the same error for a reason
[§3](#compatibility) gives.

<a id="COMP-ENV-006"></a>**`COMP-ENV-006`** — A validator encountering a
`specVersion` it does not support MUST reject the document with
`ERR_UNSUPPORTED_SPEC_VERSION` and MUST NOT attempt a best-effort
interpretation.

<a id="COMP-ENV-007"></a>**`COMP-ENV-007` — an optional field is omitted,
not written `null`.** A field accepts `null` only where `null` means something
omission does not, and a field written `null` outside those places is rejected
in the `structural` phase with `ERR_INVALID_TYPE`. This rule is here rather
than beside each field because it is a property of the whole contract: a
three-state field — absent, `null`, present — modelling a two-state idea is
three states in every SDK generated from this document, forever, and nothing
reads the third.

One placement survives in v1, and it is named rather than left to judgement:
[§5](#workload)'s `schedule: null`, where a *forbidden* field is written in its
own empty form and `null` is an author saying "deliberately none". A future
field where clearing an inherited value differs from not setting one would be
the second; this contract has no patch semantics, so there is none.

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

`metadata` carries `revision` and nothing else. A component document has no
`slug`. A [blueprint](../../blueprint/v1/spec.md#identity) and its listing each
name the item they are two halves of; a component is not the item, and the name
it answers to is the stem of the file that holds it — which is what a repo-local
reference spells out in full
([blueprint §4.1](../../blueprint/v1/spec.md#component-reference)). Any other
property is `ERR_UNKNOWN_FIELD`, as [§2](#envelope) requires at every level.

`revision` is an integer, 1 or greater. It is REQUIRED and never defaulted, so
what a node deploys is a function of this file alone.

**The revision names a position in one component's lineage.** It is not a SemVer
triple and carries no compatibility meaning: nothing is derivable from the
distance between 2 and 7, and nothing is promised about how one revision behaves
against another. It orders, and that is the whole of its job.

**Two reference forms pin it, and only one writes it down.**

| Reference form | What pins the revision |
|---|---|
| Repo-local | The referenced document's own `metadata.revision`. The node's `revision` MUST NOT be present. |
| Published | `revision` on the node. |

**A revision is used once.** Each publication of a component MUST carry a revision
strictly greater than the highest already published for that component. Gaps are
permitted — 1 to 7 is a release and not an error — but a revision that does not
increase is rejected in the `capability` phase with `ERR_VERSION_NOT_MONOTONIC`.

Reuse is the case the rule exists for. `revision: 3` on a published node
is the whole of what that node deploys, and a registry that let 3 mean two
different documents would make the pin name nothing. The repo-local form has the
same problem one step removed: a blueprint that deployed revision 3 last month
and revision 3 today, with different bytes behind it, has no way to say so.

**Why the phase is `capability`.** Deciding the rule needs to know what was
published before, which needs the catalog, which needs the network — and
[§7](#validation-layers) forbids the `parser`, `structural` and `semantic`
phases from requiring it. A client validating a file it has just written cannot
see the lineage and MUST NOT report this rule. Offline validation is therefore
exactly as strict as it was.

Whether a registry treats an identical re-submission as a no-op rather than as a
publication is outside this contract. This document orders publications; it does
not define when two YAML files are the same document.

**The revision is not the item's revision.**
[Blueprint §3](../../blueprint/v1/spec.md#identity) pins a blueprint to its
sibling listing, and neither is pinned to any component beneath it. The two
numbers count different things: an item's revision counts releases of the item, a
component's counts releases of the component, and in the published form one
component is deployed by many items at once.

A release of a component an item deploys SHOULD be accompanied by a release of
the item, because the listing describes what would be installed and a component
that has moved makes that description stale. It is a SHOULD and carries no
diagnostic: the disagreement is visible only across two revisions, and a
validator is handed one.

**What v1 does not constrain.** Nothing orders one component's revisions against
another's — two components in the same item sitting at 4 and 11 mean nothing
worth reading into. Nothing checks a revision offline at all: `minimum: 1` is the
whole of the `structural` rule, and every other statement in this section is
either `capability` or a SHOULD.

## <a id="workload"></a>5. The component's shape

A component declares exactly one of `spec.workload` and `spec.external`, and
which key is present is what says whether this platform runs it.
[§5.1](#source) through [§5.5](#volumes) describe the first; [§5.6](#external)
describes the second.

<a id="COMP-EXT-001"></a>**`COMP-EXT-001`** — `spec` MUST declare exactly one of
`workload` and `external`. `structural`. A document declaring neither is
`ERR_MISSING_FIELD` at `/spec`, the field an author has to add; one declaring
both is `ERR_INVALID_VALUE` at `/spec/workload`, the field that should not have
been there.

`spec.workload` says how the component runs. Its `type` is the runtime shape,
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
it would leave `type` describing nothing: two documents would differ in the
word they use for a workload that runs identically, and a reader could not tell
from the `type` whether anything could reach it.

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

**A build-argument name takes the environment-variable grammar.** A key of
`build.arguments` MUST match `^[A-Z_][A-Z0-9_]*$` and be 1 to 128 characters,
and one that does not is rejected in the `structural` phase with
`ERR_INVALID_VALUE`. It becomes an environment variable in the build context,
so it is bound by the same POSIX shape [§5.3](#env-vars) requires of a runtime
key, for the same reason: a name outside it is not portably settable.

**Image references MUST be pinned.** An unpinned reference mutates under
whoever curates the registry, shifting a deployment with no change to any
document in the item. Two layers enforce it, and the split between them is
deliberate.

A reference MUST carry a tag or a digest. A bare name — an implicit `:latest` —
is rejected in the `structural` phase with `ERR_INVALID_VALUE`. That is a
grammar, so the schema carries it.

<a id="COMP-SRC-001"></a>A reference MUST NOT carry a floating tag. The floating set is `latest`,
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
probe's `endpoint` and a platform default's are both OPTIONAL — and the primary
endpoint is what an omitted one selects. It is:

1. the workload's sole endpoint, where it declares exactly one; failing that
2. its sole `PUBLIC` endpoint, where it declares exactly one; failing that
3. nothing.

<a id="COMP-EP-001"></a>Where it is nothing, a reference that omits the endpoint is rejected in the
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
| `LITERAL` | `value`, and OPTIONAL `sensitive` | The value itself. An empty string is permitted. |
| `CONFIG_REF` | `configKey` | A reference. The document never holds the value. |

<a id="COMP-ENVVAR-001"></a>**A key is declared once.** Two entries sharing a key are rejected in the
`semantic` phase with `ERR_DUPLICATE_ENV_KEY`, anchored at the **later** of the
two — the first declaration is the one that stands, so the second is the one an
author has to change. Without this rule the sequence shape would make a repeated
key mean whatever an implementation's last write happened to be.

<a id="COMP-ENVVAR-002"></a>**A key is claimed by one declaration.** An input's
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

**Sensitivity.** `sensitive` on a `LITERAL` marks the value as secret
material. An implementation MUST treat a marked value as
[§6.1](#inputs) requires of a generated input: masked in read surfaces, and
never echoed back into logs, diagnostics, or interfaces. It defaults to `false`,
so an unmarked literal is handled as ordinary configuration.

A `CONFIG_REF` carries no marking and needs none. It names a value resolved
elsewhere and the document holds only the name, so there is nothing in this file
to mask.

A component SHOULD carry secret material as a `CONFIG_REF`, or as an input with
a `generator` ([§6.1](#inputs)), rather than as a marked literal. `sensitive`
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

<a id="COMP-EP-002"></a>`endpoint` names the endpoint whose port the probe targets; omitting it selects
the primary endpoint [§5.2](#endpoints) elects, and is rejected with
`ERR_AMBIGUOUS_ENDPOINT` where that section elects none. A probe naming an
endpoint the workload does not declare is rejected with `ERR_UNKNOWN_ENDPOINT`.
Both are `semantic`, and the schema can express neither — the endpoint names are
mapping keys elsewhere in the document, and JSON Schema cannot constrain a value
against a sibling's keys.

**A probe MUST name an endpoint in the HTTP family.** Every probe polls an HTTP
<a id="COMP-EP-003"></a>path, so an endpoint whose `protocol` is `TCP` or `UDP` has nothing for one to
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

`volumes` is a mapping from volume name to a declaration. `sizeGiB` and
`mountPath` are REQUIRED. `accessMode` (default `READ_WRITE_ONCE`) and
`readOnly` (default `false`) are OPTIONAL.

**A volume name is a DNS label.** A name MUST match
`^[a-z][a-z0-9-]{0,61}[a-z0-9]$` — the grammar
[blueprint §4](../../blueprint/v1/spec.md#components) uses for a node name — and
one that does not is rejected in the `structural` phase with
`ERR_INVALID_VALUE`. A volume is materialised under its name, so the name has
to survive being one.

`mountPath` MUST be absolute. A relative path is rejected in the `structural`
phase with `ERR_INVALID_VALUE`.

`accessMode` decides how the materialised volume is shared across replicas.
`READ_WRITE_ONCE` is an attached block volume and mounts on a single replica;
`READ_WRITE_MANY` is a shared network volume and mounts on every replica.

**What v1 does not constrain.** Two volumes on one workload MAY declare
overlapping mount paths, and `sizeGiB` has no lower or upper bound. Neither
silence is a considered permission — both are gaps, in this specification and
in the implementations reading it, and they are recorded here rather than
described aspirationally so that a reader can tell which silences are
decisions. Closing either one rejects documents that validate today and is
therefore a breaking change.

### <a id="external"></a>5.6 External components

`spec.external` says that this platform does not run the component. Present
instead of [`workload`](#workload), it describes a node addressed elsewhere —
a service the deploying user already has, or one another provider operates.

```yaml
spec:
  external:
    resourceType: dev.musher.llm.chat-completions
  contract:
    inputs: { … }
    outputs: { … }
```

**The block carries one field, because there is one thing to say.** An external
node has no image, no compute, no endpoints, no health and no address of its
own. What it *is* is named by `resourceType`; what it *holds* arrives through
[`contract.inputs`](#inputs) like any other configuration, and what it offers
the rest of the graph leaves through [`contract.outputs`](#outputs).

<a id="COMP-EXT-002"></a>**`COMP-EXT-002`** — `external.resourceType` is
REQUIRED and takes the grammar [§6.3](#value-schema) fixes. `structural`; an
absent identifier is `ERR_MISSING_FIELD` and an ungrammatical one
`ERR_INVALID_VALUE`. It is REQUIRED rather than defaulted for the reason
[`COMP-GEN-001`](#COMP-GEN-001) gives for `sensitive`: an identifier a document
may leave out is one two implementations may read differently, and introducing
it later is introducing a required field later.

**It is the same grammar and the same registry as a value's, read of a
different thing.** A value's `resourceType` says what that value addresses,
which is what [blueprint §4.2](../../blueprint/v1/spec.md#connections) compares
across a wire. This one says what the *node* is, which is what a reader of the
graph needs in order to see one participant rather than three unrelated
strings. Three tagged outputs do not compose into a node's identity, and
electing one of them as the node's would be the designated-primary mistake
[listing §3](../../listing/v1/spec.md#identity) rejects for a `COMPONENT` item.

<a id="COMP-EXT-003"></a>**`COMP-EXT-003`** — An external component MUST
publish at least one output. `structural`; an absent `contract` is
`ERR_MISSING_FIELD` and a `contract` whose `outputs` mapping is empty is
`ERR_INVALID_VALUE`. The two spellings carry different codes for the reason
[§5](#workload) gives for a `SERVICE` declaring no endpoint — the author who
omits the block has not said what the node offers, and the author who writes it
empty has said, and said nothing.

A node exists in a composition so that something can consume it. One publishing
nothing is a node nothing can need, which is the same argument that makes a
`SERVICE` exposing no port a `WORKER` under another name.

<a id="COMP-EXT-004"></a>**`COMP-EXT-004`** — An external component's outputs
MUST NOT declare `valueFrom: DERIVED`. `structural`, `ERR_INVALID_VALUE`.
[§6.2](#outputs) makes a `DERIVED` value come from the running workload, and
there is no running workload. `DECLARED` and `INPUT` both stay available, and
`INPUT` is the member this shape exists alongside: an external node's values are
what the deploying user supplies it.

<a id="COMP-EXT-005"></a>**`COMP-EXT-005`** — An external component's inputs
MUST NOT carry a `platformDefault` or a `generator`. `structural`,
`ERR_INVALID_VALUE`. It is the pair [§6.1](#inputs) already excludes beside
`suppliedBy: CONNECTION`, for reasons that survive the change of setting: a
platform default derives from the component's own public addressing, which an
external node does not have, and a generator mints a secret this platform would
then not be sharing with the service that has to accept it.

**The exclusion is about what `SELF_ADDRESS` means.** `platformDefault.type`
has one member and it reads the component's own addressing. A second kind that
resolved a value from a resource the organisation already holds would be
meaningful on exactly this shape; [§10](#known-debt) records the exclusion as
reviewable when one arrives rather than as a considered permission.

**What v1 does not constrain.** Nothing here reaches the service the node
addresses. No phase resolves the address, tests that anything answers at it, or
compares what answers against `resourceType` — and [§11](#security) explains
why that is a rule rather than an omission.

## <a id="contract"></a>6. Configuration contract

`spec.contract` is what makes a component composable. `inputs` are values the
component needs; `outputs` are values it publishes for another component to
consume. A [Blueprint](../../blueprint/v1/spec.md) connection joins one node's
output to another node's input, and this section defines both ends of that
join.

`contract` is OPTIONAL. A component that neither consumes nor publishes
configuration omits it.

**An input or output name is `lowerCamelCase`.** A name MUST match
`^[a-z][a-zA-Z0-9]{0,63}$`, and one that does not is rejected in the
`structural` phase with `ERR_INVALID_VALUE`. The grammar is load-bearing
rather than cosmetic: the name is bound by key across three documents — the
input, the [connection](../../blueprint/v1/spec.md#connections) key that fills
it, and the [parameter](../../blueprint/v1/spec.md#authored-parameters) that
covers it — so two spellings of one name are two names. It is not the
environment-variable key either; that is what [`target`](#inputs) carries, on
the POSIX grammar [§5.3](#env-vars) fixes.

### <a id="inputs"></a>6.1 Inputs

`schema` is the only REQUIRED property of an input. `suppliedBy` decides who
satisfies it and defaults to `USER`.

| `suppliedBy` | Satisfied by | `ui` |
|---|---|---|
| `USER` | The deploying user, through the install form. | REQUIRED |
| `CONNECTION` | A blueprint connection, from an upstream output. | MUST NOT be present |

<a id="COMP-UI-001"></a>**`COMP-UI-001`** — A `USER` input MUST declare `ui`.
`structural`, `ERR_MISSING_FIELD`. A form cannot render a field it has no label
for, and `suppliedBy` defaults to `USER`, so an input saying nothing about who
satisfies it is bound by this.

<a id="COMP-UI-002"></a>**`COMP-UI-002`** — A `CONNECTION` input's `ui` MUST NOT
be present. `structural`, `ERR_INVALID_VALUE`. Such an input never reaches the install
form, so presentation metadata on one is a statement about a form it will never
appear on.

What `ui` contains, and what a client draws from it, is
[§6.4](#install-form).

<a id="COMP-GEN-001"></a>**`COMP-GEN-001` — a generated input is secret
material.** An input carrying `generator` — one whose value the platform mints at
deploy time — MUST declare `suppliedBy: USER` and `schema.sensitive: true`, and
MUST NOT carry a `platformDefault`. Both markings MUST be written explicitly
rather than left to a default: `sensitive` defaults to `false`, and a generated
value not marked sensitive is echoed back into logs and interfaces. All three are
`structural`.

The value rides on a `USER` input because that is the slot the install form
already reserves for it — the user simply does not have to type it. A
`platformDefault` is excluded because minting a value and deriving one are two
answers to the same question, and nothing would say which arrives.

**A platform default supplies the value the deploying user does not.**
`platformDefault` is OPTIONAL. Where it is present, `type`
is REQUIRED and names the kind of default, `source` is REQUIRED and selects what
is derived, and `endpoint` names which endpoint it is derived from.

`type` has one member, `SELF_ADDRESS`, which derives the value from the
component's own public addressing. It is REQUIRED and carries no default, for the
reason [`COMP-GEN-001`](#COMP-GEN-001) gives for `sensitive`: a discriminator a
document may leave out is one two implementations may read differently. A second
kind is admitted beside this one without invalidating a document written against
it, which is the whole reason the tag is written now rather than when a second
kind arrives — adding it later would be adding a required field.

**A platform default does not make a field disappear.** An input carrying one
still reaches the install form, and still carries `ui`. "This is filled in for
you, override it only for a custom domain" is a thing worth being able to say,
and it is the same argument
[blueprint §5.1](../../blueprint/v1/spec.md#derivation) already makes for a
generated input. That is why `suppliedBy: USER` beside a `platformDefault` is
not a contradiction but the ordinary case: the platform fills it, and the user
may type over it.

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

`endpoint` is OPTIONAL, and omitting it selects the primary endpoint
[§5.2](#endpoints) elects. Since a component MAY expose several `PUBLIC`
endpoints, one that does MUST name the endpoint here: an omitted `endpoint`
elects nothing there and is rejected with `ERR_AMBIGUOUS_ENDPOINT`.

<a id="COMP-EP-004"></a>Three further rules follow the name, all `semantic`. An endpoint the workload
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
for the reason [§5.2](#endpoints) gives: the primary is what an omitted
selector means, so a
rule about the endpoint a reference means reaches it equally.

**A platform default is not a `CONNECTION`.** The value comes from the
component's own workload, never from an upstream node, which is the same line
[§6.2](#outputs) draws around an output. An input declaring
`suppliedBy: CONNECTION` therefore MUST NOT carry a `platformDefault`, and MUST
NOT carry a `generator` either: a wire already answers the question both of them
answer. `structural`, `ERR_INVALID_TYPE` in both cases, anchored at the field
that should not have been there.

An earlier draft of this section recorded the first of those as a gap —
"`suppliedBy` is unconstrained by `platformDefault` in v1". It is a gap the
shape can close, and a gap the shape can close is not one to describe.

### <a id="outputs"></a>6.2 Outputs

`schema` and `valueFrom` are REQUIRED.

| `valueFrom` | Carries | Where the value comes from |
|---|---|---|
| `DECLARED` | `value`, REQUIRED and non-empty | This document. |
| `DERIVED` | neither | The platform, from the running workload. |
| `INPUT` | `input`, REQUIRED | One of this component's own inputs. |

**An output depends on its own node and nothing else.** A `DECLARED` output's
value is written in this document. A `DERIVED` output's value comes from the
producing workload's own addressing — its private address, its public URL. An
`INPUT` output's value is one this component's own contract already receives.

That constraint is what makes an output referenceable at all: a consumer can
read a producer's output without the producer having first been told anything.
It is also what lets two components consume each other.
[Blueprint §4.2](../../blueprint/v1/spec.md#connections) permits a cyclic
connection graph, and this rule is why it can: every output in a composition is
resolvable before any connection is bound, so a cycle among the connections
leaves nothing unresolved.

**The invariant is resolvability before any edge is bound, and that is what the
rules below enforce.** A `USER` input resolves when the install form is
submitted, which is *earlier* than a `DERIVED` output resolves — that one needs
a running, addressed workload. An input carrying a `generator` is minted at
deploy time out of nothing. An input carrying a `platformDefault` reads the
component's own addressing, which [§6.1](#inputs) already calls the same line
this section draws. Only a `CONNECTION` input resolves after an edge is bound,
and it is the only one an output may not read.

<a id="COMP-OUT-001"></a>**`COMP-OUT-001`** — `input` is REQUIRED where
`valueFrom` is `INPUT`, and MUST NOT be present on any other member.
`structural`; a missing `input` is `ERR_MISSING_FIELD` and one written beside
`DECLARED` or `DERIVED` is `ERR_INVALID_VALUE`.

<a id="COMP-OUT-002"></a>**`COMP-OUT-002`** — `input` MUST name an input this
component declares. `semantic`, `ERR_UNKNOWN_INPUT_REFERENCE`, anchored at the
output's `input`. The name is a mapping key elsewhere in the same document,
which is the class of reference [§7](#validation-layers) puts in the `semantic`
phase.

<a id="COMP-OUT-003"></a>**`COMP-OUT-003`** — The named input's `suppliedBy`
MUST NOT be `CONNECTION`. `semantic`, `ERR_INPUT_NOT_REFERENCEABLE`. An output
reading a wired input would depend on an inbound edge, which is the dependency
this section's invariant exists to exclude — and it is what would make
blueprint §4.2's legal cycles unresolvable rather than merely cyclic.

**An earlier draft of this section stated the invariant as "an output MUST NOT
depend on a value the component received over an inbound connection".** That is
a sufficient condition rather than the necessary one, and the necessary one is a
step weaker: what an output may not read is a value that resolves after an edge
is bound. `INPUT` is admitted on that reading, and nothing about `DECLARED` or
`DERIVED` changes.

**Where an output must fit the input it feeds.** An output's `schema` and the
`schema` of the input it is wired to must agree on `type`, and on
`resourceType` wherever the consuming input names one.
[Blueprint §4.2](../../blueprint/v1/spec.md#connections) states the rule and
carries the two diagnostics, because the connection is what joins the two ends
and a component document sees only one of them.

### <a id="value-schema"></a>6.3 Value schemas

An input and an output carry the same `schema` block, and this section defines
it once. `type` is its only REQUIRED property.

**A value is carried as text.** Whatever an input receives or an output
publishes reaches the workload as an environment variable, so `type` does not
name a host language's type — it names the shape the value's **string form**
takes. That is why `default` is a string, why `enum` is a list of strings, why a
`DECLARED` output's `value` is a string, and why `pattern` is a regular
expression over the same form.

<a id="COMP-VAL-001"></a>**`COMP-VAL-001`** — `type` MUST be one of four
members. Anything else is rejected in the `structural` phase with
`ERR_INVALID_VALUE`.

| `type` | The string form is | `format` | `pattern` | `enum` |
|---|---|---|---|---|
| `STRING` | any text | permitted | permitted | permitted |
| `NUMBER` | a JSON number — `5432`, `-1`, `2.5` | forbidden | permitted | permitted |
| `BOOLEAN` | `true` or `false`, in lower case | forbidden | permitted | permitted |
| `JSON` | a JSON value of any kind — object, array, string, number, boolean or null | forbidden | forbidden | MUST be empty |

**There is no integer member, and the omission is deliberate.** `NUMBER` is
JSON's own numeric kind and covers whole numbers and reals alike. An author who
needs whole numbers writes the constraint rather than reaching for a second
type: `type: NUMBER` with `pattern: '^-?[0-9]+$'`. A separate `INTEGER` would
have to answer whether `5432.0` is one, whether an integer output satisfies a
number input under [blueprint §4.2](../../blueprint/v1/spec.md#connections)'s
no-widening rule, and what a bound would mean on each — three answers bought for
a distinction the transport does not preserve.

<a id="COMP-VAL-002"></a>**`COMP-VAL-002`** — Where `type` is `JSON`, `pattern`
MUST NOT be present and `enum` MUST be empty. Both are `structural`: a
`pattern` is `ERR_INVALID_VALUE` and a non-empty `enum` is `ERR_INVALID_VALUE`.

One JSON value has many spellings. `{"a":1}` and `{ "a" : 1 }` are the same
value, and so are `{"a":1,"b":2}` and `{"b":2,"a":1}`. A regular expression and
a string enumeration each decide membership on the spelling, so a rule written
with either would accept one author's formatter and reject another's. Permitting
them and leaving "equal" undefined is the worse option: two implementations
would then disagree about a valid document for a reason neither could see.

<a id="COMP-VAL-003"></a>**`COMP-VAL-003`** — Where `type` is not `STRING`,
`format` MUST NOT be present. `structural`, `ERR_INVALID_VALUE`.

Every `format` member names a lexical convention for text. `format: EMAIL` on a
`BOOLEAN` describes nothing, and that it validates today is an accident of the
two fields never having been described together. This clause is about the Musher
field `format`, not the JSON Schema keyword; [§7.2](#format-policy) is that.

<a id="COMP-VAL-004"></a>**`COMP-VAL-004`** — `format` is OPTIONAL, and where it
is present MUST be one of six members. Anything else is rejected in the
`structural` phase with `ERR_INVALID_VALUE`.

| `format` | The text is | Where the convention is published |
|---|---|---|
| `EMAIL` | a mailbox address | [RFC 5321 §4.1.2](https://www.rfc-editor.org/rfc/rfc5321#section-4.1.2) |
| `URI` | a URI | [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986) |
| `ENDPOINT_URL` | a URL addressing a network service | " |
| `CONNECTION_STRING` | a backing service's own connection form | the service's |
| `HOSTNAME` | a host name, and no port | [RFC 1123 §2.1](https://www.rfc-editor.org/rfc/rfc1123#page-13) |
| `TIMEZONE` | a time-zone identifier | the [IANA Time Zone Database](https://www.iana.org/time-zones) |

The membership is written here rather than left to the schema's `description`,
which is informative. That is the defect
[ADR 0013](../../../docs/adr/0013-value-shape-vocabulary.md) closed for `type`,
and `format` was one sentence away from it.

**`HOSTNAME` is the host alone.** [§6.1](#inputs) already separates the two —
`PUBLIC_HOSTNAME` derives the host part and `PUBLIC_ADDRESS` the whole
`host:port` — for the reason given there: a consumer that takes host and port as
separate settings should not have to split a string this contract had already
composed. An input receiving one of them can now say which it received.

**`TIMEZONE` names a vocabulary this contract does not decide.** The identifiers
are IANA's — an `Area/Location` name such as `Europe/London` — and IANA revises
them several times a year, when a jurisdiction changes its rules and not when
this repository releases.
[ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) §2
therefore obliges this section to name where they are published and forbids it
from restating them, dated or otherwise. The `format` member is this contract's;
the membership behind it is not. A renderer needs no list shipped with it —
every mainstream runtime already carries the database.

**None of the six is checked.** The paragraph below records that no phase tests a
value against the shape its `schema` declares, and `format` is no exception. Nor
is `TIMEZONE` resolved in the `capability` phase, which
[ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) §3 reserves
for a membership a server decides and which nothing here asks it to: an author is
saying what convention a value follows, not asking for it to be confirmed. That
is a deviation from ADR 0003 §3's usual routing and is recorded rather than left
to be noticed.

<a id="COMP-VAL-005"></a>**`COMP-VAL-005` — `resourceType` names the resource a
value addresses.** It is OPTIONAL, and where it is present MUST match
`^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$` — a reverse-DNS namespace, then one or
more lowercase segments. A value outside the grammar is rejected in the
`structural` phase with `ERR_INVALID_VALUE`.

`type` is the primitive shape a value takes; `resourceType` is what it
addresses, and the two answer different questions. A Postgres connection string
and a MySQL one are both `STRING` and both plausibly `CONNECTION_STRING`-shaped,
and wiring one into a consumer expecting the other is the mistake this tag
exists to catch — [blueprint §4.2](../../blueprint/v1/spec.md#connections)
carries the rule that does the catching.

**The grammar is this contract's and the membership is not.** Which identifiers
exist is decided by what the platform offers and by what a third party
publishes, neither of which this repository observes, so it fixes the shape and
names the surface: the identifiers on offer are served, unauthenticated, at
`https://api.musher.dev/v1/reference/resource-types`. This document does not
restate them, not even informatively and not even dated, for the reason
[ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) §2 gives.

**A grammatical identifier the registry does not name is reserved, not
invalid.** Deciding membership needs the registry, which needs the network,
which [§7](#validation-layers) forbids the earlier phases from reaching — so it
is `capability`, it carries `ERR_UNKNOWN_RESOURCE_TYPE`, and an offline
implementation MUST NOT report it. A namespace is what lets a component address
something this specification never heard of, and an offline validator rejecting
`com.acme.billing.tenant-key` would defeat the whole point of having one.

**`resourceType` is not paired with `type`.** Nothing here restricts which types
may carry which identifier — a `JSON` value describing a Postgres cluster
addresses that cluster as legitimately as a connection string does. That the
pairing goes unchecked in either direction is a gap rather than a considered
permission; the registry records a primitive type per identifier, and nothing in
this contract reads it.

**What v1 does not check.** No phase tests a **value** against the shape its
`schema` declares. A `DECLARED` output may write `type: NUMBER` beside
`value: 'banana'`; a `default` may ignore the `pattern` and the `enum` written
beside it; a `JSON` value's `default` is not parsed. None of this is new with
`JSON` — it has been true of every member since v1 — and it is recorded here
rather than described aspirationally, because the table above is the first place
a reader could reasonably expect the check to be. Closing any of them rejects
documents that validate today.

### <a id="install-form"></a>6.4 Install-form presentation

`ui` is the presentation metadata a `USER` input carries, and this section
defines it. [`COMP-UI-001`](#inputs) requires one; [`COMP-UI-002`](#inputs)
forbids one where there is no form to appear on.

<a id="COMP-UI-003"></a>**`COMP-UI-003`** — `label` is `ui`'s only REQUIRED
member, and `ui` admits no member this section does not name. A missing `label`
is `ERR_MISSING_FIELD` and an unknown member is `ERR_UNKNOWN_FIELD`, both
`structural`.

| Member | Presence | Means |
|---|---|---|
| `label` | REQUIRED | What the field is called. |
| `order` | OPTIONAL | Where the field sits. Lower sorts first. |
| `prominence` | OPTIONAL | How prominently it is offered. Default `PRIMARY`. |
| `examples` | OPTIONAL | Values illustrating the form the value takes. |
| `enumLabels` | OPTIONAL | What each `enum` member is called. |

**`ui` says how a value is asked for, never what it is.** Nothing here changes
what a value means or what would validate, which is what keeps the data contract
and the rendered control from being two declarations that can disagree. That is
also why the control itself is not declared — see the derivation below.

<a id="COMP-UI-004"></a>**`COMP-UI-004`** — `prominence` MUST be `PRIMARY` or
`SECONDARY`. `structural`, `ERR_INVALID_VALUE`. `PRIMARY` is offered directly;
`SECONDARY` is offered behind a disclosure the deploying user opens. It is
distinct from `required`: an optional field may be either, and a form of
eleven fields where three are optional is not the same form as one where three
are advanced.

**`examples` is never submitted.** It illustrates the form a value takes. A
value that is actually submitted when the user supplies none is
[`schema.default`](#value-schema), and the two are different claims — an example
may be one nobody should deploy. Where a value carries an `enum`, `examples`
says nothing a chooser does not already show, and a client SHOULD ignore it.

<a id="COMP-UI-005"></a>**`COMP-UI-005`** — Every `enumLabels` key MUST be a
member of the sibling `schema.enum`. A key naming no member is rejected in the
`semantic` phase with `ERR_UNKNOWN_ENUM_MEMBER`, anchored at that key.

`enumLabels` is keyed by the member rather than held in a list beside `enum`,
so the labels cannot fall out of step with the members by length or by order,
and so a member labelled twice is `ERR_DUPLICATE_KEY` in the `parser` phase
([§7.1](#yaml-profile)) rather than a rule this section would have to invent. A
member with no label is offered as it is spelled, which is what a document
written before this section existed already does. A label naming no member is
the other direction and is the error: it is a typo that changes nothing a
validator would otherwise see, and it would stay invisible for the life of the
document.

The rule is `semantic` rather than `structural` because it relates a mapping's
keys to a sibling array's items, and JSON Schema has no keyword that does that.
That is the same line [§7](#validation-layers) draws everywhere else.

**Where the labels live, and why not in `schema`.** `enumLabels` is presentation
and sits in `ui` with the rest of it.
[Blueprint §5.2](../../blueprint/v1/spec.md#merge) decides whether two components
declaring one input agree by comparing their `schema` blocks and deliberately not
their `ui` blocks. Labels in `schema` would therefore make two components that
word one enumeration differently a rejected composition —
`ERR_CONFLICTING_INPUT_SCHEMA` over a difference of phrasing. In `ui` the first
node's wording wins, which is a presentation decision and is what that section
already says it is making.

#### The derivation

**The control is derived from the value's `schema`, and this is that
derivation.** A client rendering the install form MUST derive each field's
control from the value's `schema` and `ui` as follows, and MUST NOT require any
further declaration in order to do it. Where more than one row applies, the
first that applies decides.

| Where the value's `schema` says | The control |
|---|---|
| `sensitive: true` | MUST conceal the value as it is entered, and MUST NOT display a stored one. |
| a non-empty `enum` | MUST offer those members, under their `enumLabels` wording where one is given, and MUST NOT offer a value outside them. |
| `type: BOOLEAN` | MUST offer exactly `true` and `false`. |
| `type: JSON` | SHOULD accept text spanning more than one line. |
| `format: EMAIL` | SHOULD offer a control specialised for a mailbox address. |
| `format: TIMEZONE` | SHOULD offer the identifiers [§6.3](#value-schema) names. |
| anything else | accepts text. |

The order matters in one place and is stated rather than left to chance: a
secret drawn from an enumeration is concealed rather than listed, because
`sensitive` is read first.

**This clause binds an implementation's output rather than a document**, which
[listing §4.1](../../listing/v1/spec.md#description-markdown) is the only other
place in these specifications to do. There the grounds were security; here they
are that this contract has already spent the alternative. `ui` carries a label
and no control *because* the control is derived, and a `widget` member is
withheld on the same reasoning — a control declared beside the schema it renders
is one fact stated twice, with nothing to decide which is wrong when they
disagree. A derivation that is not written down makes `ui` not a minimal
contract but an incomplete one, and leaves two conforming implementations free
to render one document differently with neither of them defective.

**It carries no requirement identifier.** No document can violate it, and
[conformance/README.md](../../../conformance/README.md#requirements) reserves an
identifier for a rule one can. What the corpus holds down instead is the rules
that make the derivation total —
[`COMP-UI-001`](#inputs) through [`COMP-UI-005`](#install-form) and
[`COMP-VAL-004`](#value-schema) — each of which is a statement about a document.

**Field order.** A client SHOULD present fields in ascending `ui.order`. An input
declaring none sorts after every input that declares one, and inputs that tie —
including all of them, in a document that declares no order at all — sort by
input name, compared as UTF-8 bytes. The tiebreak is written down for the reason
[`COMP-ENVVAR-002`](#env-vars) writes down its own: a mapping has no sequence,
and an order left implicit is whichever order an implementation happens to
iterate in.

**What this does not constrain.** No widget, no medium, no library, and no
appearance. Nothing here obliges a control to *reject* a value the `schema`
would reject: [§6.3](#value-schema) records that no phase tests a value against
its schema, and this section opens no such phase — the `enum` and `BOOLEAN` rows
say what a control offers, not what the platform will accept. A client that
renders every field as a text box and every enumeration as a list of its members
is defective; one that chooses a different-looking chooser than another client
is not.

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

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="COMP-YAML-001"></a>`COMP-YAML-001` | A document MUST be encoded in UTF-8. Malformed UTF-8 is rejected. | `ERR_INVALID_YAML` |
| <a id="COMP-YAML-002"></a>`COMP-YAML-002` | A document MAY begin with a UTF-8 byte order mark. It carries no meaning and MUST be ignored. | — |
| <a id="COMP-YAML-003"></a>`COMP-YAML-003` | Line endings MAY be LF or CRLF, and carry no meaning. | — |
| <a id="COMP-YAML-004"></a>`COMP-YAML-004` | A file MUST contain exactly one YAML document. The `---` and `...` markers MAY be present; a stream carrying more than one document is rejected. | `ERR_MULTIPLE_DOCUMENTS` |

A file holding two documents has no answer to "which one is the component",
and picking the first silently discards a thing the author wrote.

**Structure**

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="COMP-YAML-005"></a>`COMP-YAML-005` | Every mapping key MUST be a string. A numeric, boolean, null, or complex key is rejected. | `ERR_NON_STRING_KEY` |
| <a id="COMP-YAML-006"></a>`COMP-YAML-006` | A mapping key MUST NOT appear twice. | `ERR_DUPLICATE_KEY` |
| <a id="COMP-YAML-007"></a>`COMP-YAML-007` | A document MUST NOT declare an anchor or an alias. | `ERR_ANCHOR_OR_ALIAS` |
| <a id="COMP-YAML-008"></a>`COMP-YAML-008` | A document MUST NOT use a merge key (`<<`). | `ERR_MERGE_KEY` |
| <a id="COMP-YAML-009"></a>`COMP-YAML-009` | A node MUST NOT carry an explicit tag — neither a custom tag (`!secret`) nor a core-schema tag (`!!str`). | `ERR_EXPLICIT_TAG` |

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

| ID | Bound | Limit | Diagnostic |
|---|---|---|---|
| <a id="COMP-YAML-010"></a>`COMP-YAML-010` | Document size | 1 MiB (1 048 576 bytes) | `ERR_DOCUMENT_TOO_LARGE` |
| <a id="COMP-YAML-011"></a>`COMP-YAML-011` | Nesting depth | 64 levels | `ERR_DEPTH_EXCEEDED` |
| <a id="COMP-YAML-012"></a>`COMP-YAML-012` | Scalar length | 64 KiB (65 536 bytes) | `ERR_SCALAR_TOO_LONG` |

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

### <a id="format-policy"></a>7.2 The `format` keyword

This clause is about the JSON Schema **keyword** `format`, not about the
component field named `format` that [§6.1](#inputs) gives an input. The two are
unrelated: the field is a Musher enum with its own rules, and no schema this
repository publishes uses the keyword at all.

Should one ever appear, `format` is an **annotation and asserts nothing**. That
is the JSON Schema 2020-12 default rather than a shortcut: `format` constrains a
value only where the Format Assertion vocabulary is explicitly declared, and no
Musher schema declares it.

A validator MUST NOT reject a document because a value fails a `format`
keyword, and MUST NOT accept one it would otherwise reject because a value
satisfies one.

The reason is portability. `format` implementations differ — one library's
`uri` accepts what another's rejects, and `email` is worse — so a schema that
depended on `format` for rejection would validate differently depending on which
library a consumer happened to link. A rule that must hold everywhere is written
with an assertion keyword instead: `pattern`, `enum`, `minLength`, `const`. Where
a rule cannot be expressed that way, it belongs to the `semantic` phase and
carries a diagnostic of its own.

Adopting the Format Assertion vocabulary later would make previously valid
documents invalid, so it is a breaking change and needs an ADR.

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
| `ERR_INPUT_NOT_REFERENCEABLE` | `semantic` | An `INPUT` output names an input whose `suppliedBy` is `CONNECTION`. |
| `ERR_UNKNOWN_INPUT_REFERENCE` | `semantic` | An `INPUT` output names no input this component declares. |
| `ERR_UNKNOWN_ENUM_MEMBER` | `semantic` | An `enumLabels` key names no member of the sibling `enum`. |
| `ERR_UNKNOWN_RESOURCE_TYPE` | `capability` | A `resourceType` is grammatical but the registry names no such identifier. |
| `ERR_VERSION_NOT_MONOTONIC` | `capability` | A published component version is not greater than the lineage's current version. |

The `parser` and `structural` rows are the shared envelope registry: the
[blueprint](../../blueprint/v1/spec.md#diagnostics) and
[listing](../../listing/v1/spec.md#diagnostics) families declare themselves
additions to this table rather than restating it. The `semantic` and
`capability` rows are this family's own, with one named exception:
`ERR_UNKNOWN_ENUM_MEMBER` belongs to the `ui` block
[§6.4](#install-form) defines, and a blueprint parameter carries that block
unchanged ([blueprint §5.3](../../blueprint/v1/spec.md#authored-parameters)), so
that family reports it too. The row is declared once here rather than restated
there, which is the rule
[ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) §2 applies
to a vocabulary and this table is no different.

## <a id="conformance"></a>9. Conformance

An implementation conforms to this specification when it produces the declared
outcome for every fixture in
[`conformance/component/v1/`](../../../conformance/component/v1/).

Implementations MUST run the fixture corpus in their own CI. Passing a fixture
that is declared to fail is a conformance failure.

An implementation MUST declare the **profile** it claims. Conformance is not a
single claim: `capability` needs an account, a region, and a quota, so an
implementation a user runs locally cannot reach it, and an editor integration
that checks structure is a useful thing to be without being a control plane.
The profiles, and the report shape a claim should take, are defined in
[conformance/README.md](../../../conformance/README.md#profiles).

A skipped case is never a passed one. An implementation MUST NOT claim a
profile while skipping any case in a phase that profile requires.

## <a id="known-debt"></a>10. Known debt

This schema was seeded from the platform's Pydantic-generated catalog schema.
The naming that arrived with it — `$defs` keys carrying `Seed…`/`…Request`
affixes, and generated `title` values like `Specversion` — has been cleaned,
and `tools/src/lint.ts` now rejects both. No section of this document is marked
TODO any longer: every rule it states is stated in prose, and the schema
implements the prose rather than standing in for it.

**The vocabulary debt is closed.** Schema `description` fields no longer speak
the platform's vocabulary. The phrase that named it — "resolved server-side at
snapshot compute" — described a pipeline stage a reader outside
`musher-dev/platform` could not look up, and it is gone: a `CONFIG_REF` is now
described as this document describes it, a name whose value is resolved
elsewhere and never appears in the file ([§5.3](#env-vars)). Descriptions are
explanatory rather than normative, so nothing here turned on them; a reader who
could not resolve the words was still being sent somewhere they could not reach.

The Compute Profile half closed earlier.
[Blueprint §4.3](../../blueprint/v1/spec.md#node-compute) carries the slug
grammar and names where the offered profiles are published, so a slug like
`general.standard.small` resolves for a reader outside the platform.
[ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) records
the rule that decided it.

**What the install form still cannot say.** [§6.4](#install-form) gives a field
a name, a position, a standing and a wording for its choices. It gives it no
**grouping**: an eleven-field form is presented as one list, and a component
cannot say that three of its fields belong together under a heading.

That is a gap and not an oversight. A group name declared on an input is a claim
about a form that will also hold *other components'* inputs, which the declaring
document cannot see — the line [§6.2](#outputs) draws around an output, for the
same reason. Two components that name one section "Network" and "Networking" are
both right, [blueprint §5.2](../../blueprint/v1/spec.md#merge) has no basis to
reconcile them, and no author is in a position to fix it. `order` survives that
objection because a total order can always be produced from what a merged form
already has; a grouping cannot. Admitting one later is additive and stays free;
admitting a bad one is not, so it is recorded here rather than shipped.

**What an external component still cannot say.** [§5.6](#external) gives a node
this platform does not run an identity, a set of inputs and a set of outputs.
What it does not give is a *configured instance* two blueprints share: one saved
address and credential that three compositions point at. Every deployment
instantiates its own node and asks for its own values.

That is a gap with a reason rather than an oversight.
[Blueprint §4.2](../../blueprint/v1/spec.md#connections) is explicit that a
connection cannot reach outside the graph it is written in, so sharing an
instance needs a reference form that does, plus a phase to resolve it — a new
contract surface rather than a field. What *is* reusable today is the
definition: many blueprints may reference one component document, and
[listing §3.1](../../listing/v1/spec.md#component-item) already admits a catalog
item that is a single standalone building block, so a general-purpose external
component ships as its own item with nothing added to the listing family.

**The `platformDefault` exclusion on an external input is reviewable.**
[`COMP-EXT-005`](#COMP-EXT-005) rejects the field because its one member reads
the component's own addressing and an external node has none. A second kind that
resolved a value from a resource the organisation already holds would be
meaningful there, and admitting it would be a relaxation rather than a
narrowing. Recorded so the exclusion is not later read as a decision about
platform defaults as a class.

**An `input` reference has no grammar of its own.** [§6.2](#outputs)'s `input`
names a mapping key, and [§6](#contract) fixes the grammar those keys take, so
the reference is constrained by the same pattern the referent is. That is one
grammar rather than two, which is deliberate; it is recorded because a reader
looking for a rule about the reference will find it stated about the key.

What remains for this family is not a gap in the prose. `capability` rules —
`ERR_UNKNOWN_COMPONENT`, `ERR_VERSION_NOT_MONOTONIC`,
`ERR_COMPONENT_NOT_PUBLISHED`, `ERR_UNKNOWN_COMPUTE_PROFILE` — carry no
conformance fixture, because deciding any of them needs the catalog and no phase
a client runs may reach the network. Each is recorded with that reason in the
runner's `UNCOVERED` list rather than left to be assumed tested.

## <a id="security"></a>11. Security considerations

This section is addressed to **implementations**: what a validator, a CLI, or a
control plane must do so that reading an untrusted component document is safe.
[SECURITY.md](../../../.github/SECURITY.md) is the separate question of what counts as a
vulnerability *in this repository* and how to report one.

A component document is untrusted input. It arrives from a pull request, a
catalog submission, or a `POST` body, and every consideration below assumes its
author is hostile.

**Parsing.** [§7.1](#yaml-profile) is a security boundary as much as an
interoperability one. Aliases are refused because expansion is where a small
document becomes a large one, and the size bound is measured before parsing
because a limit applied after the tree exists is not a limit on the work done to
build it. An implementation MUST enforce all three bounds, and MUST NOT raise
them to accommodate a document that exceeds them.

An implementation MUST NOT resolve YAML tags to host language types. The tag ban
makes this unreachable through a conforming parser, but a parser configured to
construct arbitrary objects from tags is the classic deserialisation
vulnerability, and the ban is not a substitute for choosing a safe loader.

**Regular expressions.** Every `pattern` this specification publishes is free of
lookaround and backreferences, which is what lets it compile under RE2 as well as
under a backtracking engine. An implementation evaluating these patterns on a
backtracking engine SHOULD apply a match timeout regardless: the guarantee is
about the patterns published here, not about any the platform composes with them.

**Image references.** [§5.1](#source) requires a tag or a digest and forbids a
floating tag, and both rules are about supply chain rather than tidiness. A
floating tag means the artifact that runs is not the artifact that was reviewed.
`ERR_UNPINNED_IMAGE` is `semantic` and therefore offline: an implementation MUST
NOT resolve a reference over the network to decide it, because doing so would let
a document under review make the validator issue a request to a host the document
chose.

**Build sources.** A `GIT` source names a repository and a revision that an
implementation will fetch and build. Fetching is a `capability` concern and out
of scope here, but an implementation MUST treat the build context as untrusted:
a checkout is attacker-controlled content, and a build path from it MUST NOT be
allowed to read outside the context it was given.

**Environment variables and secrets.** A component document is a public artifact
— it is committed, published in a catalog, and shipped inside a release tarball.
`envVars` carries configuration, and a literal value in one is visible to
everyone who can read the document. A secret MUST NOT be written as a `LITERAL`
value; that is what `CONFIG_REF` exists for. Nothing in the `structural` or
`semantic` phase can detect a secret pasted into a literal, so this is a rule
about authoring that an implementation SHOULD surface as a warning where it can.

An implementation MUST NOT include resolved configuration values in a diagnostic
message. Diagnostics are logged, attached to pull requests, and printed in CI
output, and a validator that echoes the value it rejected turns a validation
error into a disclosure.

**An external component's address MUST NOT become an egress vector.** The
address an [external node](#external) is configured with is supplied by an
author or by a deploying user, which makes it attacker-influenced in the sense
this section opens with. No phase of this specification resolves it, connects to
it, or checks that anything answers there, and an implementation MUST NOT do so
on this contract's behalf: a reachability check against a user-supplied address
is a server-side request forgery primitive reachable from a catalog submission,
and it would reach cloud metadata endpoints and private-mesh services as
readily as the service the author meant. [§5.6](#external) records the same rule
as a validation silence; it is repeated here because the reason is a security
one and a reader of that section would otherwise read a gap where there is a
decision.

The consequence is that `resourceType` and `format: ENDPOINT_URL` on an external
node are claims, unverified, exactly as [§6.3](#value-schema) records of every
`format` member. What the node addresses is what its author says it addresses.

**Schema retrieval.** Every published bundle is self-contained: all `$ref`s
resolve inside `$defs`, and no validator needs a network request to evaluate a
document ([README](../../../README.md)). An implementation SHOULD vendor the
schema at an exact version rather than fetching it, and MUST verify what it
fetches if it does — the `.sha256` beside each pinned URL and `published.json`
are there for that. A validator that resolves schemas over the network at
validation time is an SSRF primitive and a runtime dependency on an origin it
does not control.
