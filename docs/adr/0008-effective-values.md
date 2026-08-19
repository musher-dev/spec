# ADR 0008: Effective values, and what a document means where it says nothing

- **Status:** Accepted
- **Date:** 2026-08-19
- **Extends:** [ADR 0002](0002-conformance-case-trees.md) §1
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

This contract states defaults everywhere. A probe that declares only `path`
takes `initialDelaySeconds: 10`, `periodSeconds: 10`, `timeoutSeconds: 5`,
`successThreshold: 1` and `failureThreshold: 3`. An input's `isRequired`
defaults true and a parameter's defaults false, and
[blueprint §5.3](../../specifications/blueprint/v1/spec.md#authored-parameters)
turns that difference into a diagnostic. Roughly forty `default` keywords across
the three bundles decide behaviour.

**None of them is enforced by validation.** `default` in JSON Schema 2020-12 is
an annotation: it describes, it does not apply. A validator that never reads it
is conforming, and every validator this repository gates on — Ajv, Blaze — is
configured not to.

So the corpus checks a document is accepted and stops. Four implementations can
pass every fixture and behave differently the moment they act on one:

- one materialises defaults at ingest, and cannot afterwards tell a stored
  `periodSeconds: 10` from one the author typed;
- one leaves the field absent and reads the default at the point of use;
- one reads a different default, because it re-typed the number from the prose;
- one treats an explicit `null` as distinct from an omission, and the other
  three do not.

This is not hypothetical. `musher-dev/platform` is **already two of them at
once**: probe timings are filled by Pydantic at ingest and stored as concrete
integers, while an input's `schema.default` stays declarative and is applied only
at compose time. Two behaviours, one keyword, and nothing in this repository
notices.

### Why this is the corpus's problem and not the prose's

The prose could say "`periodSeconds` defaults to 10" more loudly. It already
does. What it cannot do is make the claim **executable** — and
[CONTRIBUTING.md](../../CONTRIBUTING.md) ground rule 1 makes the corpus the
executable form of the prose for observable outcomes, alongside the bundle for
structural validity. A behaviour the prose asserts and no fixture can hold down
is exactly the shape of defect ADR 0002 was written to close, one layer up.

## Decision

### 1. A document has an effective value at every field the schema defines

**The effective value of a field is what the author wrote; where they wrote
nothing, it is the `default` the schema declares for that field; where neither
exists, the field has no effective value and nothing may depend on one.**

An implementation MUST behave as though every field held its effective value.

### 2. Representation is not constrained, and deliberately

An implementation **MAY** hold an absent field as absent, materialise its default
at ingest, or compute it on demand. It **MUST NOT** behave differently from one
that holds the effective value.

The alternative — obliging implementations to normalise a document into a
canonical form — was rejected. It would make an internal object model part of a
public contract, oblige a validator to emit a document rather than a verdict, and
give a stored-value implementation and a compute-on-demand implementation
different conformance obligations for identical behaviour. What matters is that
the two agree about the interval, not that they agree about the field.

### 3. An absent ancestor has no descendants

Where a field's own effective value is `null` or absent, no field beneath it has
an effective value. A component that omits `health` entirely does not thereby
acquire a readiness probe polling every ten seconds; it acquires no probe.

This is stated because it is the rule a fixture is most likely to get wrong, and
because the wrong reading — defaults cascading into a subtree the author never
opened — invents configuration nobody wrote.

### 4. `null` is not a value a default may be reached through

Where the prose says an absent field and an explicit `null` mean the same thing,
they mean the same thing here too: both take the field's effective value.
[ADR 0007](0007-naming-conventions.md) §5 is removing most of those `null`
branches for an unrelated reason, which narrows where this rule has to be
applied but does not change it.

### 5. A conformance case MAY pin effective values

`metadata.json` gains an OPTIONAL `effective` object on a passing case, keyed by
JSON Pointer:

```json
{
  "expected": "pass",
  "effective": {
    "/spec/workload/health/readiness/periodSeconds": 10,
    "/spec/workload/health/readiness/timeoutSeconds": 5
  }
}
```

Forbidden on a failing case: a rejected document has diagnostics, not values.
The map is normative; whether an implementation reaches the value by storing it
or by computing it is not.

This changes the conformance fixture contract, which
[GOVERNANCE.md](../../GOVERNANCE.md) §Decision process reserves for an ADR. This
is that ADR, as ADR 0002 was for `tree/`.

### 6. The runner checks the map against the bundle, not against itself

`tools/src/effective.ts` walks the document and the bundle in step and answers,
for one pointer, whether the value was written, defaulted, or is absent.
`tools/src/conformance.ts` fails a case whose pin contradicts either side. That
catches the two ways a fixture goes wrong — inventing a default the schema does
not declare, and contradicting a value the document does — and the third, pinning
a field that has no effective value at all.

The resolver handles the four shapes this contract uses to reach a value —
`$ref`, `properties`, `additionalProperties` for a typed mapping, `items` — plus
`anyOf`'s nullable idiom, and **reports anything else as unresolvable rather than
guessing**. It is not a general JSON Schema evaluator and must not grow into one:
[ADR 0001](0001-canonical-repository-architecture.md) §6 forbids this repository
publishing a reference implementation, and a resolver that guesses is worse than
one that stops, because the fixture it green-lights is the one nobody re-reads.

## Alternatives considered

**Require implementations to normalise.** Rejected in §2. It constrains the
object model rather than the behaviour, and the behaviour is what interoperates.

**Enable Ajv's `useDefaults` and diff the result.** Rejected. It would make one
validator's default-application semantics normative by accident — and Ajv
declines to apply defaults inside `anyOf`, which is where a large share of this
contract's defaults currently sit. A contract that quietly meant "the defaults
Ajv happens to apply" is worse than no rule.

**Say nothing, and let implementations agree informally.** This is the status
quo, and §Context is what it produced: one downstream implementation holding both
behaviours simultaneously, with every gate green.

## Consequences

**Fixtures can pin behaviour, not only acceptance.** This is the first thing the
corpus can say about a document it accepts. Cases that exercise defaults should
acquire an `effective` map as the phases that add defaults land.

**Four phases of this pass have somewhere to put their defaults.** The scheduling
block, the probe bounds, and the value-schema reshape all add or move defaults,
and each now lands with the meaning pinned rather than asserted.

**A pin is a claim a reviewer can check by reading two files.** The map and the
schema's `default` are both in the diff.

**The runner grows a resolver that must stay small.** §6 is a boundary, not a
description: the moment it needs `if`/`then` evaluation to answer a pointer, the
right move is to decline that pointer, not to implement conditionals.
