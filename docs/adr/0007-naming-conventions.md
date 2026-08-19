# ADR 0007: Naming, casing, and the identifier grammars

- **Status:** Accepted
- **Date:** 2026-08-19
- **Extends:** [ADR 0001](0001-canonical-repository-architecture.md) §6
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

[CLAUDE.md](../../CLAUDE.md) carries a naming table, and `tools/src/lint.ts`
enforces the half of it that is mechanical — directory case, module filenames,
bundle filenames, `$defs` keys, `title` placement. What neither says is how to
name a **field**, how to spell a **value**, or what a **key** in a user-authored
mapping may look like. Those were decided one field at a time, which is why:

- `metadata.version` is an integer this specification spends five paragraphs
  saying is not a version in any sense a reader expects;
- `isRequired`, `isSensitive` and `isReadOnly` carry an `is` prefix that
  `readOnly` — a keyword this repository already publishes in its own schemas —
  does not;
- `sizeGib` is spelled in neither the binary form (`GiB`) its description uses
  nor the decimal one (`GB`) it appears to claim, and `acceleratorMinVramGb`
  says `Gb` while describing GiB;
- `acceleratorRuntime` and `cpuArchitecture` are arrays with singular names;
- `workload.kind` and the document's `kind` are the same word for a discriminator
  of a runtime shape and a discriminator of a document family;
- **endpoint names** and **node names** carry a `propertyNames` grammar, and
  input, output, parameter, volume, connection, build-argument and tag
  identifiers carry none at all.

None of these is wrong in isolation. Together they are the reason a reader
cannot predict a name they have not seen, which is the property a naming
convention exists to provide.

### Why now

[ADR 0005](0005-platform-divergence-reconciliation.md) §1 opened a
**pre-publication window**: while a family has no tag, a change that rejects a
previously valid document needs no new major directory. Every rename below is
such a change. `git tag -l` is empty and the three `1.0.0` release pull requests
are open, so this ADR is being written in the last period where its decisions
are free rather than a `v2`.

### What is not in question

`musher-dev/platform` is the downstream implementation, and its own
`.claude/rules/api-conventions.md` records two rules this specification already
follows. They are adopted here rather than re-litigated:

| Concern | Rule | Source |
|---|---|---|
| Wire property names | `camelCase` | platform api-conventions §JSON Casing |
| Enum values | `UPPER_SNAKE_CASE` | platform ADR 0047 |

An external review proposed re-casing every enum value to PascalCase
(`kind: Component`, `type: Service`). It is rejected: the value spelling is
settled by a decision that predates this one and is enforced downstream, and
"more readable in YAML" does not outweigh two repositories agreeing.

## Decision

### 1. Field names

| Rule | Consequence |
|---|---|
| Properties are `camelCase` | Unchanged; already true everywhere |
| `kind` names a **document family** and nothing else | `workload.kind` becomes `workload.type` |
| `type` discriminates a tagged union or a subcategory | `source.type`, `value.type`, probe `type` |
| A boolean is an adjective, never `is…`-prefixed | `isRequired` → `required`, `isSensitive` → `sensitive`, `isReadOnly` → `readOnly` |
| A collection's name is plural | `acceleratorRuntime` → `acceleratorRuntimes`, `cpuArchitecture` → `cpuArchitectures` |
| A reference to another object ends `Ref` | the blueprint node's `component` → `componentRef` |
| A unit in a name is spelled as the unit is spelled | `GiB`, `IOPS`, `VRAM`, `SKU` |
| A name says what a value *is*, not how advanced it is | `advanced` → `placement` |

**On `is…`.** The prefix is not merely redundant. It reads as a question in a
field that answers one, and it forces a reader to hold two vocabularies for the
same idea — this contract publishes `readOnly` as a JSON Schema keyword in its
own bundles while spelling its own field `isReadOnly` four lines away.

### 2. Units are spelled correctly, or not at all

A binary unit is `GiB` and a decimal one is `GB`, and a field name that picks
the wrong one is a specification asserting something false about the number
beside it. Where a description already says `GiB`, the name follows it:

| Today | Becomes |
|---|---|
| `sizeGib` | `sizeGiB` |
| `acceleratorMinVramGb` | `minAcceleratorMemoryGiB` |
| `storageMinIops` | `minStorageIOPS` |
| `acceleratorSkuClass` | `acceleratorSKUClass` |

The `min…` prefix moves to the front because it qualifies the whole quantity
rather than the unit: `minStorageIOPS` is a floor on IOPS, where `storageMinIops`
reads as a property called "min IOPS" belonging to storage.

**Acronyms keep their conventional case** (`IOPS`, `SKU`, `VRAM`, `URL`, `ID`,
`API`, `CPU`, `GPU`), except where an acronym begins a `camelCase` name, when its
first letter lowercases like any other (`idempotencyKey`, not `iDempotency…` and
not `IDKey`).

### 3. `version` names a specification release; `revision` names a lineage

**`metadata.version` becomes `metadata.revision`, in all three families.**
`componentVersion` becomes `revision` inside [§4](#4-one-name-per-identifier-and-a-grammar-for-each)'s
`componentRef`.

Component §4 already argues the case against the current name at length: the
field "is not a SemVer triple and carries no compatibility meaning: nothing is
derivable from the distance between 2 and 7, and nothing is promised about how
one version behaves against another. It orders, and that is the whole of its
job." A specification that spends five paragraphs telling a reader a field is
not what it is called has identified a naming defect and documented it instead.

`revision` says the four things the prose has to spell out — monotonic, integral,
a position in one lineage, no compatibility claim — in one word a reader already
holds.

**`version` is retained for exactly one thing**: a release of this
specification. `specVersion: v1` keeps its name.

**The collision this creates, and how it is resolved.** The platform's *resource*
envelope spends `metadata.revision` on a different idea — a server-set,
`readOnly` counter on a reconciled resource
(`platform/.claude/rules/schema-design.md` §3). A document envelope and a
resource response are formally distinct, and that rule file says so, but a user
meets both and would meet `metadata.revision` twice meaning two things: one they
author, one they may not touch.

The resource counter moves. Kubernetes separates the two ideas by name —
`metadata.generation` counts spec changes, `metadata.resourceVersion` is the
store's version — and `generation` is the accurate name for what the platform is
counting. This is recorded here because the decision is this repository's to
make and the work is not: it is filed downstream, and it renames a `readOnly`
response field, so it invalidates no document anyone has authored.

### 4. One name per identifier, and a grammar for each

Every user-authored mapping key is an **identifier**, and each one gets a named
grammar in the schema as a `propertyNames.pattern`. Two exist today; the rest are
unconstrained, which means the contract accepts an input named with a single
space, or a volume named `../../etc`, and has nothing to say about either.

| Identifier | Grammar | Rationale |
|---|---|---|
| Node name | `^[a-z][a-z0-9-]{0,61}[a-z0-9]$` | Unchanged. A DNS label; composed into hostnames |
| Endpoint name | `^[a-z][a-z0-9]{0,19}$` | Unchanged. Composed into a DNS label *beside* other slugs, so a hyphen would make the composition ambiguous |
| Volume name | `^[a-z][a-z0-9-]{0,61}[a-z0-9]$` | A DNS label; materialised as a named volume |
| Input, output, and parameter name | `^[a-z][a-zA-Z0-9]{0,63}$` | `lowerCamelCase`. These are read by people in an install form and bound by key across documents |
| Connection key | The input grammar | It *is* an input name — [blueprint §4.2](../../specifications/blueprint/v1/spec.md#connections) makes the map key the input being filled |
| Environment-variable key | `^[A-Z_][A-Z0-9_]*$` | Unchanged. The POSIX shape; a name outside it is not portably settable |
| Build-argument name | The environment-variable grammar | It becomes an environment variable in the build context |
| Tag | `^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$` | Lowercase kebab; compared after normalisation |

**Why `lowerCamelCase` for the contract identifiers rather than kebab.** They are
bound by key across three documents — an input name, the connection key that
fills it, and the parameter that covers it must all be spelled identically — and
they are the one identifier class that also appears in generated SDK types.
Kebab-case survives neither destination without a translation nobody has to
write today.

**These grammars narrow what validates.** Under ADR 0005 §1 that is admissible
now and is not admissible after the first tag, which is the whole reason this
table is being written rather than deferred.

### 5. An optional field is omitted, not written null

**A field accepts `null` only where `null` means something omission does not.**

The component schema alone carries 27 `"null"` branches — `builderImage`,
`dockerfilePath`, the git `ref`, every probe, `schedule`, `description`,
`generator`, `platformDefault`, `target`, `ui`, `endpoint`, `command` — and the
prose says, field by field, that absence and `null` mean the same thing. Each one
is therefore a three-state field (absent, null, present) modelling a two-state
idea, in every SDK generated from this contract, forever.

Nothing depends on the distinction. The platform's patch layer already collapses
an explicit `null` to "unchanged" rather than to "clear", so no implementation
reads the third state as anything.

Two placements survive, and both are named rather than left to judgement:

- **`schedule: null`** and the other "written in its own empty form" spellings
  that component §5 permits for a *forbidden* field. That `null` is an author
  saying "deliberately none" where the alternative is a field that must be
  absent, and §5's argument for it stands.
- Any future field where clearing an inherited value differs from not setting
  one. There are none in v1; this contract has no patch semantics.

Everywhere else the `"null"` branch is removed and the field is simply optional.

### 6. Where a rule here disagrees with a schema, the schema changes

This ADR is not descriptive. Every table above is a change to at least one
published module, each lands with conformance fixtures per
[CONTRIBUTING.md](../../.github/CONTRIBUTING.md) ground rule 2, and each is declared
breaking in its commit trailer per ADR 0005 §1.

## Alternatives considered

**PascalCase enum values**, as an external review proposed. Rejected in Context:
the spelling is fixed by platform ADR 0047, this repository already agrees with
it, and re-casing every value across three schemas, nine examples and 145
fixtures buys readability in one document format at the cost of two repositories
agreeing on anything.

**Raising `cpuDedication`'s `shared`/`dedicated` to UPPER_SNAKE**, to remove what
looks like the one casing inconsistency in the contract. Rejected: it is not an
enum. [Blueprint §4.4](../../specifications/blueprint/v1/spec.md#advanced-constraints)'s
pins are lowercase **grammar tokens** whose vocabularies this contract does not
fix, expressed as a `pattern` rather than an `enum` for exactly that reason, and
`cpuDedication` is spelled as its neighbours are because it is one of them. The
schema's own `$comment` already says so. An apparent inconsistency that turns out
to be a category distinction is worth leaving visible.

**Keeping `metadata.version` and documenting why.** Rejected in §3. The
collision it avoids is real, but it is resolved by moving a `readOnly` field
nobody authors rather than by keeping a name the prose argues against.

**Deferring the identifier grammars to v2.** Not available. Adding a
`propertyNames` pattern rejects documents that validate today, so the choice is
between deciding them inside the pre-publication window and never deciding them
inside v1 at all.

## Consequences

**A reader can predict a name.** Booleans are adjectives, collections are plural,
references end `Ref`, units are spelled correctly, `kind` is the document family
and `type` is everything else. That is the whole benefit, and it is only worth
the churn because the churn is free this month.

**Every downstream implementation re-generates.** The platform, the CLI, both
SDKs, and `musher-dev/examples` all carry these names. The migration is gated:
the platform pins this repository at `apps/api/config/spec.ref` and runs the
conformance corpus as a blocking check, so the rename either passes that gate or
is not done.

**The window closes behind this.** After the first tag every table above is a
`v2` change on ordinary terms. An identifier grammar not written down here is one
this major version does not get.

**One name is retired without a replacement.** `advanced` becomes `placement`,
and nothing else in the contract is called advanced. A field named for how
difficult it is rather than what it does was describing the reader.
