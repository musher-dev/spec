# ADR 0013: The value-shape vocabulary, and what `JSON` means in it

- **Status:** Accepted
- **Date:** 2026-08-19
- **Extends:** [ADR 0003](0003-controlled-vocabulary-placement.md) §1
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

An input's `schema.type` and a blueprint parameter's `schema.type` name the
**shape** of a configuration value. Until this ADR the vocabulary was `STRING`,
`INTEGER`, `BOOLEAN`. Three things about that are worth stating together,
because no one of them would have been worth a decision on its own.

**The vocabulary was published nowhere.** Neither `spec.md` enumerated the
members. Component §6.1 and §6.2 discussed `schema` and `type` at length without
ever saying what `type` may contain, while every neighbouring vocabulary —
`suppliedBy`, `platformDefault.source`, `valueFrom` — got a prose table. The only
statement of membership anywhere was a schema `description` string, and
[CONTRIBUTING](../../.github/CONTRIBUTING.md) ground rule 1 makes `description`
fields *informative*. So the meaning of `type` was defined in a field this
repository declares non-normative. That is survivable for three self-evident
primitives and stops being survivable the moment a member arrives whose meaning
is not self-evident.

**The platform diverged.** `musher-dev/platform` PR #1997 adopted `STRING`,
`NUMBER`, `BOOLEAN`, `JSON` — JSON's own value kinds — and filed
[issue #54](https://github.com/musher-dev/spec/issues/54) against this
repository asking for two conformance fixtures to be renamed. The issue had the
divergence inverted: it cited a "§10" defining the new vocabulary, and no such
section exists here. Applying the rename as filed would have broken this
repository's CI in exactly the two ways the issue described, mirrored — a `pass`
fixture failing structurally on a token the schema does not admit, and a
`semantic` mismatch fixture dying before the rule it exists to pin.

This is the first schema-shaped divergence since
[ADR 0010](0010-runtime-divergence-reconciliation.md) recorded that the two
repositories' bundles were "in lockstep", and unlike ADR 0010's seven it **is**
visible in a diff. That is what makes it cheap to settle.

### Why now

`git tag -l` is empty, `published.json` records `"releases": {}`, and the three
`1.0.0` release pull requests are still open, so
[ADR 0005](0005-platform-divergence-reconciliation.md) §1 applies. `check:compat`
replays each release's documents out of that release's own tag; with no tags it
has nothing to replay, and that emptiness is the mechanical form of the same
fact.

Withdrawing an enum member rejects documents that validate today. Under the
window that costs maintainer approval and a breaking declaration in the commit
trailer — not a `v2` directory and not a migration note. **Adding members stays
free forever; withdrawing one is free now and never again.** That asymmetry, and
not the platform's timetable, is why this is decided in this pass.

## Decision

### 1. `INTEGER` is withdrawn, and `NUMBER` replaces it

`NUMBER` is JSON's own numeric kind and covers whole numbers and reals alike. An
author who needs whole numbers writes the constraint rather than reaching for a
second type: `type: NUMBER` with `pattern: '^-?[0-9]+$'`.

**Rejected:** keeping both, which was the cheaper change — purely additive, and
therefore not a breaking one. It was rejected on what it would have obliged the
contract to answer. Is `5432.0` an `INTEGER`? Does an `INTEGER` output satisfy a
`NUMBER` input, given that [blueprint §4.2](../../specifications/blueprint/v1/spec.md#connections)
permits no widening in either direction? What would a bound mean on each? Three
answers bought for a distinction the transport does not preserve — and under
that no-widening rule, two near-synonymous numeric shapes make independently
authored components reject each other over a difference no consumer can observe.

What is given up is real and is worth naming: integrality is no longer
expressible as a shape. The value schema has never carried `minimum` or
`maximum`, so `pattern` was already the only quantitative lever the contract
had, and `type: NUMBER` with a digit pattern says strictly more about a port
than `type: INTEGER` ever did.

### 2. `JSON` is added, and it names a string form rather than a host type

A value reaches the workload as text. `default` is a string, `enum` is a list of
strings, a `DECLARED` output's `value` is a string, and `pattern` is a regular
expression over that same form. `type` therefore names the shape the value's
**string form** takes, and a `JSON` value's string form is a JSON document.

Read that way, `JSON` needs no change to any sibling field: a default is written
`default: '{"logLevel":"info"}'`, quoted, and the
[YAML profile](../../specifications/component/v1/spec.md#yaml-profile) makes the
unquoted spelling self-diagnosing — it parses as a flow mapping and fails
`type: string`.

**Rejected:** widening `default` to accept arbitrary JSON. It would make one
field mean two things depending on a sibling, and it would break the schema
canonicalisation `ERR_CONFLICTING_INPUT_SCHEMA` compares blocks with.

### 3. `pattern` and `enum` are forbidden on a `JSON` value

One JSON value has many spellings. `{"a":1}` and `{ "a" : 1 }` are the same
value, and so are `{"a":1,"b":2}` and `{"b":2,"a":1}`. Both keywords decide
membership on the spelling, so a rule written with either would accept one
author's formatter and reject another's.

**Rejected:** permitting them under a defined JSON equality. Deciding whether
equality is byte-wise, parsed, or key-order-sensitive is a new normative surface,
bought for a rare case, and the failure it would leave behind is the one this
contract refuses everywhere else — two implementations disagreeing about a valid
document for a reason neither could see.

### 4. `format` is confined to `STRING`

Every `format` member — `EMAIL`, `URI`, `ENDPOINT_URL`, `CONNECTION_STRING` —
names a lexical convention for text. The field's own `description` has always
said so and nothing enforced it, so `format: EMAIL` on a `BOOLEAN` validates
today and describes nothing.

This is stated as a decision of its own rather than folded into §2, because it
is the one narrowing here that `JSON` did not cause: it was reachable before
this ADR and would have stayed reachable after it. It is taken now because the
window closes once, and because a member table that lists which shapes accept
`format` is the first place a reader will assume the restriction is real.

**`semanticType` is deliberately not paired with `type`.** It tags the backing
service a value addresses rather than the shape the value takes, so a `JSON`
value describing a Postgres cluster is as legitimately `POSTGRES` as a
connection string is. Restricting it would have foreclosed that.

### 5. A `default` is not checked against the constraints beside it

For any member. A `DECLARED` output may write `type: NUMBER` beside
`value: 'banana'`; a `default` may ignore the `pattern` written next to it; a
`JSON` default is not parsed.

**Rejected:** a `semantic` rule requiring a `JSON` default to parse.
`ERR_INVALID_VALUE` is registered `structural`, and the corpus gate refuses a
`semantic` case declaring a `structural` code — so the rule would have cost a new diagnostic
code, a registry row, and an implementation, and it would have made the newest
member the only one whose `default` is validated. Also rejected:
`contentMediaType`, for the reason
[component §7.2](../../specifications/component/v1/spec.md#format-policy)
already gives about annotations that assert nothing.

The silence is recorded in §6.3 rather than closed. Closing it rejects documents
that validate today, and this ADR spends the window on the vocabulary rather
than on a check no member has ever had.

### 6. The vocabulary is published in component §6.3, and blueprint cites it

The `schema` block is shared by inputs and outputs, so it gets a subsection of
its own rather than a home inside §6.1. Blueprint carries its own `$defs` and
enforces the same rules, but does not restate the members:
[ADR 0003](0003-controlled-vocabulary-placement.md) §2's rule against mirroring a
published vocabulary applies to a sibling `spec.md` as much as to an external
surface, and blueprint §7 already uses that construction for diagnostics.

## Consequences

**Documents are rejected that validate today**, in two ways. Any document using
`type: INTEGER` — five conformance fixtures did, and they are migrated with this
change. And any pairing `format` with a non-`STRING` type, which no fixture and
no example carried, so §4 cost nothing to adopt and would have cost a major
version to adopt later.

**The window is spent further.** After the first tag, adding a fifth member is a
minor release and withdrawing one is a `v2` directory.

**Blueprint §4.2 gains a member that looks like a top type and is not.** A
`STRING` output does not satisfy a `JSON` input, or the reverse. §4.2 now says so
outright, because the first author to try it would otherwise read the rejection
as a bug.

**Nothing in `tools/` changes.** The runner compares `schema.type` by string
equality and maps Ajv keywords to diagnostic codes generically, so the
vocabulary was never encoded there. That is the property that let this change
cost nine fixtures and no new code, no registry row, and no `UNCOVERED` entry.

**The vocabulary stops being defined in an informative field.** Three
requirement IDs — `COMP-VAL-001`, `COMP-VAL-002`, `COMP-VAL-003` — now name
rules a document can violate, and each is pinned by a fixture.

## Follow-ups

1. Confirm `musher-dev/platform` adopts §3 and §4. Its PR #1997 carries the
   vocabulary but not the `pattern`, `enum` and `format` restrictions, so this is
   the one half of the change where this repository is ahead rather than behind.
2. `minimum` and `maximum` on a value schema are a separate design surface —
   whether a bound reads the string or the parsed number, how it composes with
   `pattern`, what it means on a `STRING`. Additive, so it stays available after
   the window closes, which is why it is not decided here.
