# ADR 0020: Several values from a named set, and where the multiplicity lives

- **Status:** Accepted
- **Date:** 2026-09-13
- **Extends:** [ADR 0013](0013-value-shape-vocabulary.md) §1
- **Extends:** [ADR 0018](0018-install-form-presentation.md) §1
- **Closes:** [#81](https://github.com/musher-dev/spec/issues/81)

## Context

A value's `schema.type` is one of `STRING`, `NUMBER`, `BOOLEAN`, `JSON`
([component §6.3](../../specifications/component/v1/spec.md#value-schema),
`COMP-VAL-001`). An author who wants a parameter meaning "pick several of these"
has no way to say so, and the two workarounds both fail in a way the reader can
see:

- a `STRING` carrying a comma convention the contract cannot describe, so
  nothing validates the members and `enum` — which would have named them —
  cannot be used, because the submitted value is not one member;
- a `JSON` value, which [§6.4](../../specifications/component/v1/spec.md#install-form)'s
  derivation sends to a control accepting text over more than one line. The
  deploying user is handed a document editor and asked to get JSON right by
  hand, for a question whose whole content is a list of three words the document
  already knows.

The platform's own form vocabulary carries a `MULTI_SELECT` member of
`FormFieldControl` that nothing can derive, because §6.4 derives every control
from `schema` and no `schema` admits several values at once. The assistant's
declared-form path is blocked behind the same wall. Both are blocked on this
contract rather than on a console, which is the shape of problem
[ADR 0018](0018-install-form-presentation.md) was written to make visible.

### Why now

This is **additive**. No document can carry the member today, so nothing that
validates now stops validating, and none of it depends on
[ADR 0005](0005-platform-divergence-reconciliation.md) §1's pre-publication
window. The window is nevertheless still open — `git tag -l` is empty,
`published.json` records `"releases": {}`, and the three `1.0.0` release pull
requests are still open — and that matters to the alternatives below rather than
to the decision: a term added to a controlled vocabulary can never be withdrawn
after the first tag except in a new major, so the cost of choosing the wrong
spelling here is asymmetric with the cost of choosing none.

## Decision

### 1. `STRING_LIST` joins the `type` vocabulary

`COMP-VAL-001` admits five members rather than four. A `STRING_LIST`'s string
form is a JSON array of strings, each of them a member of `enum` and each
appearing once. The empty array is the unset value.

`type` has always named the shape the value's **string form** takes rather than
a host language's type ([ADR 0013](0013-value-shape-vocabulary.md) §2), and this
member is described on exactly those terms. `default` stays a string, holding
that array's text.

### 2. `enum` is REQUIRED and non-empty, and `pattern` is forbidden

`COMP-VAL-006`. Both halves are `structural`, and both are the existing
arguments arriving through a new member rather than new ones:

- an unconstrained list of strings is what `JSON` already is, and §6.4's
  derivation would have no members to offer — a chooser with no choices is a
  text box that has been made harder to type into;
- the string form is a JSON array, `["a","b"]` and `[ "a" , "b" ]` are one value
  spelled two ways, and a regular expression decides membership on the spelling.
  That is `COMP-VAL-002`'s argument verbatim. What an author wants constrained is
  each member, and `enum` — required here — is the field that constrains each
  member.

`format` gets no clause. `COMP-VAL-003` already forbids it wherever `type` is not
`STRING`, and a `STRING_LIST` is not a `STRING`. The outcome is recorded in
§6.3's table and pinned by a fixture rather than restated as a second rule.

### 3. The multiplicity is in `type`, not in a field beside it

[#81](https://github.com/musher-dev/spec/issues/81) proposed a boolean
`multiple: true` sitting next to `type: STRING`. It is rejected, on two grounds.

**Every contract that decides this question for data puts it in the type.**

| Contract | Spelling | Where the multiplicity lives |
|---|---|---|
| JSON Schema, and the form libraries built on it | `type: array` with `items.enum` and `uniqueItems` | the type |
| Ansible `argument_spec` | `type: list` with `elements` and `choices`, per member | the type |
| AWS CloudFormation parameters | `Type: CommaDelimitedList` with `AllowedValues`, per member | the type |
| Terraform | `type = set(string)` | the type |
| Protocol Buffers, and [AIP-144](https://google.aip.dev/144) | `repeated string` | the type |
| HTML | `<select multiple>` | the **control** |

CloudFormation is the closest analogue of the five: it also carries every
parameter as a string, and its `AllowedValues` constrains each member of the list
rather than the joined text, which is what `enum` does here. HTML is the one
precedent for the word `multiple`, and there it is an attribute of `<select>` —
a statement about a control, which
[§6.4](../../specifications/component/v1/spec.md#install-form) says this block
never makes. `ui` says how a value is asked for, never what it is, and a control
word inside `schema` would be the first exception to it.

**And a member is compared everywhere the day it is added.**
[Blueprint §4.2](../../specifications/blueprint/v1/spec.md#connections) compares
`type` for equality across a wire,
[§5.3](../../specifications/blueprint/v1/spec.md#authored-parameters) requires a
parameter's to equal the input it covers, and
[§5.2](../../specifications/blueprint/v1/spec.md#merge) compares whole `schema`
blocks for merging. A new member inherits all three. A field beside `type` would
have had to be added to each of them by hand — a comparison axis in §4.2, an
agreement rule in §5.3, and an entry in the defaults §5.2 applies before it
compares — and
would have been a silent gap at any one that was missed, with CI green. A form
collecting one value where the workload reads a list of them is the failure
those three rules exist to catch, and it should not depend on three separate
people remembering the same thing.

### 4. Nothing else in the contract changes

No new diagnostic code: `ERR_MISSING_FIELD` and `ERR_INVALID_VALUE` already
carry the structural halves, and `ERR_INCOMPATIBLE_TYPE` and
`ERR_INCOMPATIBLE_PARAMETER_TYPE` already carry the relational ones.
`ui.enumLabels` applies per member exactly as it does today, unchanged and with
no rule to add. Blueprint §4.2 and §5.3 each gain a paragraph saying that the
existing equality decides the new case, so a reader is not left to work it out,
and neither gains a rule.

## Alternatives considered

**`multiple: true` beside `type: STRING`, as filed.** Rejected in §3. It is worth
recording what it buys, because it is not nothing: it is orthogonal, so a
`NUMBER` multi-select would come free later, and it is what
`musher-dev/platform` already assumes. Both are outweighed by the three places
it would have to be remembered.

**`STRING_SET`.** Terraform's `set(string)` and JSON Schema's `uniqueItems: true`
both say the uniqueness this member requires, and a name saying it too would be
honest. Rejected because "set" asserts a second thing — that order is
insignificant — which is false of both ends: an install form offers the members
in `enum` order, and a workload reading the array sees the order the user left.
Naming a property the contract does not hold is worse than not naming one it
does.

**`type: ARRAY`.** JSON's own kind, and so the member
[ADR 0013](0013-value-shape-vocabulary.md) §1's framing would reach for first.
Rejected because it says nothing about the members, and this vocabulary has no
`items` to say it with — the name would have to be read together with a required
`enum` to mean anything, which is the indirection `STRING_LIST` avoids. It would
also sit oddly beside `JSON`, which already admits an array.

**`NUMBER_LIST` and `BOOLEAN_LIST`, added at the same time.** Rejected as
speculative. Adding a term to a controlled vocabulary is a minor release forever;
withdrawing one is breaking, and free only until the first tag
(GOVERNANCE.md → Changing a controlled vocabulary). The asymmetry says to add the
member there is a demonstrated need for and no others. A list of booleans has no
meaning an install form can render, and a list of numbers has no user in the
catalog.

**A `capability`-phase check that submitted members are in `enum`.** Rejected as
out of scope and inconsistent. §6.3 records that no phase tests a value against
the shape its schema declares, for any member; opening one for this member alone
would make `STRING_LIST` the only type whose values are checked, and closing the
rest is a change that rejects documents validating today.

## Consequences

`musher-dev/platform` changes shape rather than size. The consumers
[#81](https://github.com/musher-dev/spec/issues/81) lists —
`parameterValueSchemaSchema`, the install-form control derivation, `propertyFor`,
the assistant proposal wire, `FormFieldRequest.values` and the
`propose_form_values` validator — each gain a `type` member rather than a
sibling field. The derivation that was blocked is now a row in §6.4's table:
`type: STRING_LIST` reads as `MULTI_SELECT`, above the `enum` row that reads as
a single-choice control.

`musher-dev/catalog` is unaffected. Nothing it publishes can carry the member,
and nothing it publishes stops validating.

The `type` vocabulary now has a member that is not one of JSON's value kinds,
which is a departure from
[ADR 0013](0013-value-shape-vocabulary.md) §1's framing. The framing was already
loose — `JSON` collapses object, array, string, number, boolean and null into one
member — and what it was defending was that the vocabulary be published in
normative prose rather than in a schema `description`. That still holds, and this
member arrives the same way: a row in the table, a requirement with an anchor,
and fixtures that fail without it.
