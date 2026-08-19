# ADR 0009: `semanticType` becomes a namespaced `resourceType`

- **Status:** Accepted
- **Date:** 2026-08-19
- **Extends:** [ADR 0003](0003-controlled-vocabulary-placement.md) §1
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

A component's value schema carries `semanticType`, a closed enum of seven
members:

```
POSTGRES  MYSQL  REDIS  MONGODB  S3_BUCKET  HTTP_SERVICE  SMTP
```

[Blueprint §4.2](../../specifications/blueprint/v1/spec.md#connections) makes it
load-bearing: a consumer declaring a tag requires a producer declaring the same
one, and a mismatch is `ERR_INCOMPATIBLE_SEMANTIC_TYPE`. It exists because
`type` alone cannot catch the mistake worth catching — "A Postgres connection
string and a MySQL one are both `STRING`, both plausibly
`CONNECTION_STRING`-formatted, and wiring one into a consumer expecting the
other is the mistake the tag exists to catch."

The rule is right. The vocabulary is the problem, in three ways.

**It has no scope.** Six of the seven members name a backing service; one,
`HTTP_SERVICE`, names a protocol. Nothing in the name or the description says
which kind of thing a member may be, so the next candidate is admitted or
refused on taste. Protocols, vendors, resource classes, and wire formats are all
plausible members of a list whose only stated criterion is "backing service the
value addresses".

**It only grows.** [GOVERNANCE.md](../../GOVERNANCE.md) §Changing a controlled
vocabulary is explicit about the asymmetry — adding a term is a minor release,
removing one is a new major — and names it "the whole problem". Seven members is
a vocabulary; forty is a list, and there is no mechanism that stops the second
from happening one defensible pull request at a time.

**It cannot express anything this repository did not think of.** A component
publishing a value specific to a service Musher does not offer has no way to say
so. Its author's choice is `null`, which
[§4.2](../../specifications/blueprint/v1/spec.md#connections) makes acceptable to
every consumer — so the one case where a compatibility tag would prevent a real
mistake is the case where the vocabulary has nothing to offer.

### The name is also wrong

`semanticType` says the tag carries *semantics*, which is true of every field in
every schema. What it actually carries is the identity of a **backing resource**
a value addresses. An external review made the same point independently.

## Decision

### 1. The field becomes `resourceType`, and its value is a namespaced identifier

```yaml
resourceType: dev.musher.postgresql.connection-string
```

```yaml
resourceType: dev.musher.s3.bucket-name
```

```yaml
resourceType: com.acme.billing.tenant-key
```

The grammar is fixed by this contract:

```
^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$
```

Reverse-DNS namespace, then one or more lowercase segments. Lookahead-free, so
it compiles under RE2 as well as ECMA-262, as
[component §11](../../specifications/component/v1/spec.md#security) requires of
every pattern this repository publishes.

### 2. This is ADR 0003 placement two, and the reasoning is that ADR's

[ADR 0003](0003-controlled-vocabulary-placement.md) §1 decides placement by
**who fixes membership**, not by how large or how volatile a vocabulary is. A
term this specification could add or remove by releasing belongs in a schema
`enum`. A term that becomes real when something outside this repository exists
does not.

`dev.musher.postgresql.connection-string` becomes real when the platform offers
Postgres. `com.acme.billing.tenant-key` becomes real when Acme publishes a
component using it, which this repository will never observe and must not have
to. Membership is therefore not ours, and the grammar is — which is exactly the
split ADR 0003 §1 draws for blueprint `size`, and the reason that field is a
`pattern` rather than a catalogue of tiers.

Per ADR 0003 §2, this repository **names where the vocabulary is published and
never restates its members** — not even informatively, not even dated. The
surface is `https://api.musher.dev/v1/reference/resource-types`, the sibling of
the Compute Profile surface blueprint §4.3 already names.

### 3. Comparison stays `semantic`; membership becomes `capability`

These are two different questions and they belong in different phases.

| Question | Phase | Why |
|---|---|---|
| Do the two ends declare the **same** tag? | `semantic` | Two strings and an equality. Offline, and unchanged from today |
| Is that tag **registered**? | `capability` | Needs the registry, which needs the network |

`ERR_INCOMPATIBLE_RESOURCE_TYPE` keeps §4.2's rule and its phase: a consumer
declaring a tag requires a producer declaring the same one, a consumer declaring
none accepts any producer, and a constrained consumer still rejects an
unconstrained producer. Nothing about the comparison changes except the spelling
of the tag.

`ERR_UNKNOWN_RESOURCE_TYPE` is new, is `capability`, and carries the consequence
[ADR 0003](0003-controlled-vocabulary-placement.md) §3 already established for
an externally fixed vocabulary: a client validating offline MUST NOT report it,
because a client cannot see the registry and a grammatical identifier the
registry does not name is **reserved, not invalid**.

### 4. What the registry records for each identifier

Named here so the surface has a contract rather than a shape:

| Field | Why |
|---|---|
| Identifier | The value that appears in a document |
| Meaning | What a value carrying it addresses |
| Primitive type | `string`, `integer`, `boolean` — a tag implies one, and a mismatch is a defect in the tag rather than the wire |
| Stability | Whether it may be withdrawn |
| Introduced | The release it became usable in |
| Replacement | Where a deprecated identifier points |
| Examples | One value, redacted |

This mirrors what OpenTelemetry's semantic-convention registry records, for the
same reason: an identifier without a written meaning is a string two authors
will use differently.

## Alternatives considered

**Keep the closed enum and grow it carefully**, under GOVERNANCE.md's admission
test — the rule that governs listing `category`. Rejected on the placement test:
`category` is how a buyer browses a storefront this repository defines, so its
membership is genuinely ours. Whether a `dev.musher.clickhouse.dsn` exists is
decided by whether the platform runs ClickHouse, which is not.

**Keep the enum and add an open escape hatch** — the seven members plus any
namespaced string. Rejected: it is two vocabularies for one idea, and the
unqualified members become the privileged ones, so every future addition
arrives as a request to be promoted into the enum. One form per identifier.

**Drop the tag and compare `format` instead.** Rejected, and §Context says why:
a Postgres and a MySQL connection string are both `CONNECTION_STRING`. `format`
describes a value's shape; this describes what it addresses.

**Defer to v2.** Not available. Both the rename and the grammar reject documents
that validate today, so [ADR 0005](0005-platform-divergence-reconciliation.md)
§1's window is the whole of the opportunity.

## Consequences

**A third party can express a compatibility tag.** The case the closed enum
handled worst — a component addressing something Musher does not offer — is the
case a namespace exists for.

**The vocabulary stops being a release of this repository.** Adding a resource
type becomes an entry in a registry rather than a minor version of three
schemas, and removing one stops being a new major.

**One diagnostic is added and one is renamed.** `ERR_UNKNOWN_RESOURCE_TYPE` is
new and `capability`, so per component §10's standing reason it carries no
fixture and is recorded in the runner's `UNCOVERED` list.
`ERR_INCOMPATIBLE_SEMANTIC_TYPE` becomes `ERR_INCOMPATIBLE_RESOURCE_TYPE`.

Renaming a diagnostic code is ordinarily forbidden — the platform mirrors this
registry verbatim and its own rule file says a code is never renamed or reused.
That rule protects released consumers, and there are none: no version of this
family has been tagged, so the code has never appeared in a published registry.
It is renamed now or it is wrong permanently.

**The platform must serve the registry before the tag.** Until
`/v1/reference/resource-types` exists, `ERR_UNKNOWN_RESOURCE_TYPE` is
undecidable everywhere — which is survivable, because it is `capability` and no
offline client may report it, but it is a real dependency and is filed as one.
