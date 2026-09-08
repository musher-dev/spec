# ADR 0018: The install-form control, and the vocabulary that describes it

- **Status:** Accepted
- **Date:** 2026-09-08
- **Extends:** [ADR 0013](0013-value-shape-vocabulary.md) §4
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

`ComponentInputUi` carries one property, and its `description` says why:

> The install-form control is derived from the input's schema (enum → select,
> BOOLEAN → toggle, EMAIL format → email field, sensitive → masked field) —
> only the label needs declaring.

That sentence is the whole contract between an author and a renderer, and
[CONTRIBUTING.md](../../.github/CONTRIBUTING.md) ground rule 1 declares schema
`description` fields **informative**. No `spec.md` states the mapping. Two
conforming implementations may therefore render one document completely
differently and neither is defective. That is the defect this ADR opens with,
and it is the same defect [ADR 0013](0013-value-shape-vocabulary.md) found for
`type`: a rule stated only where the repository says nothing is stated.

The rest follows from measuring what the rule is asked to carry. Across the
thirteen curated items in `musher-dev/catalog` at `dc00d3f`, twenty-eight
`USER` inputs: eleven carry a `generator`, six a `platformDefault`, and eleven
are typed by a person. Of those eleven, **`enum` is used zero times**, `format`
once, `pattern` never. Three of the four inference rules the description
promises fire exactly once each in the whole corpus; the fourth never fires.
Eight of the eleven typed inputs reach a deploying user as an undifferentiated
text box, including two — `n8n.timezone` and `openclaw.timezone` — that are the
same IANA timezone field, hand-rolled twice because the vocabulary has no way
to say what it is.

Proposed in [#78](https://github.com/musher-dev/spec/issues/78).

**Why now.** `git tag -l` is empty, `published.json` records no release, and the
three `1.0.0` release pull requests are still open, so
[ADR 0005](0005-platform-divergence-reconciliation.md) §1's pre-publication
window is open. One decision below narrows what validates and is free only
inside it. The rest are additive and would keep.

## Decision

### 1. The derivation is normative prose, and it binds a renderer

Component §6.4 states the mapping from a value's `schema` to the control that
asks for it, in a table, with RFC 2119 force. It is a new subsection rather than
a paragraph inside §6.1 because `ui` has never had a definition site — its
contents exist only in a schema `description`, which is the defect being closed
— and because §6.1 is already about who satisfies an input rather than how it is
asked for. §6.3 set that precedent when the shared `schema` block took a
subsection of its own.

**The clause constrains an implementation's output rather than a document.**
[Listing §4.1](../../specifications/listing/v1/spec.md#description-markdown) is
the only other place in these specifications to do that, and
[ADR 0004](0004-listing-description-trust-boundary.md) §3 argues it there on
security grounds. The grounds here are different and narrower: this contract has
already spent the alternative. `ui` carries a label and no control *because* the
control is derived, so a derivation that is not written down does not leave `ui`
minimal — it leaves it incomplete.

**It carries no requirement identifier**, and this is the part most likely to be
got wrong. [conformance/README.md](../../conformance/README.md#requirements):

> **An ID names a rule a document can violate.** … Rules about what an
> *implementation* does rather than what a document contains … are normative
> prose and carry no ID, because an identifier whose permanent state is
> "excused" documents nothing.

No document can violate "a non-empty `enum` renders as a chooser", and no
fixture can watch a form render. `LIST-MEDIA-004` is the repository's one
counter-example and is its recorded anomaly rather than its precedent — listing
§4.1's renderer clause, the first of the kind, carries no ID either.

What the corpus holds down instead is the set of rules that make the derivation
**total**: `COMP-UI-001` through `COMP-UI-005`, `COMP-GEN-001` and
`COMP-VAL-004`, each a statement about a document, each pinned by a fixture,
and three of them rules the corpus already tested without naming.

### 2. `format` gains `HOSTNAME` and `TIMEZONE`, and its membership moves into prose

Both pass §6.3's stated test — each names a lexical convention for text — and
both pass it more cleanly than `ENDPOINT_URL` and `CONNECTION_STRING`, which
name roles. `HOSTNAME` also matches JSON Schema's own `hostname` format name.

The membership moves out of a run-on sentence under `COMP-VAL-003` and into a
table under `COMP-VAL-004`, each row naming where its convention is published.
`type` has had a table and an identifier since ADR 0013; `format` was one
sentence away from the defect that ADR fixed.

**`TIMEZONE` is [ADR 0003](0003-controlled-vocabulary-placement.md) placement
two.** IANA decides the identifiers and revises them several times a year, not
when this repository releases, so §6.3 names where they are published and
restates none of them — the shape blueprint §4.3 already uses for Compute
Profiles. Membership is deliberately **not** resolved in the `capability` phase,
which is a departure from ADR 0003 §3's usual routing and is stated as one: an
author writing `format: TIMEZONE` is saying which convention a value follows,
not asking a server to confirm it, and §6.3 already records that no phase tests
a value against its schema at all.

**Rejected: `format: MULTILINE`.** It names no lexical convention. "The string
may contain newlines" describes a shape a box should have, which is a
presentational fact wearing a semantic field's clothes, and by §1's own argument
it belongs in `ui` or nowhere. `type: JSON` already earns a multi-line control
through the derivation table, which is the case that motivated it.

### 3. `ui` gains `order`, `prominence`, `examples` and `enumLabels` — and not `group`

Each is inert to validation: a renderer that ignores all four still produces a
correct form. None may contradict `schema`, which is what keeps the data
contract and the rendered control from being two declarations that can disagree.

`order` arrives with the rule it needs and the proposal did not supply — absent
sorts last, ties break by key compared as UTF-8 bytes — for the reason
`COMP-ENVVAR-002` writes down its own tiebreak. A mapping has no sequence, and
an order left implicit is whichever order an implementation iterates in. This
also gives the derived form an order it never had: blueprint §5.2 decides which
declaration wins, not what a form shows.

`prominence` is `PRIMARY` or `SECONDARY` rather than a boolean. `isAdvanced` was
proposed and is ruled out twice by [ADR 0007](0007-naming-conventions.md) §1 —
"a boolean is an adjective, never `is…`-prefixed", and "a name says what a value
*is*, not how advanced it is", which is the clause that retires `advanced`.
`placement`, where ADR 0007 sends `advanced`, is spent on blueprint §4.4's
compute pins, and reusing it would recreate the collision ADR 0007 §3 spends a
page resolving for `metadata.revision`. Recorded fairly:
[AIP-126](https://google.aip.dev/126) would permit a boolean here, since the
default is genuinely false; the enum is taken because a third rank is plausible
and free later, and because it names both states.

`examples` takes JSON Schema's own annotation name and arity rather than
`placeholder`, which is an HTML attribute name and describes what a renderer
does rather than what the value is. The prose says what `default` does not: it
is never submitted.

**Rejected: `group`.** The proposal offered free-text groups as the smaller
commitment. It is the larger one. A group name declared on a component input is
a claim about a form that will also hold *other components'* inputs, which the
declaring document cannot see — the line component §6.2 draws around an output,
for the same reason. Two components naming one section `Network` and
`Networking` are both right, blueprint §5.2's first-wins merge has no basis to
reconcile them, and no author is placed to fix it. `order` survives the
identical objection because a total order can always be produced from what a
merged form already holds; a grouping cannot. It is recorded as a gap in
component §10. Admitting a grouping later is additive and stays free; admitting
a bad one is not.

### 4. Enum labels are keyed by the member, and they live in `ui`

`enum` is published as an array of strings, and a stored term reaches a buyer as
the term itself: `S3` / `GCS` / `AZURE`. `ui.enumLabels` is a mapping from
member to label.

**Keyed by the member, not a parallel array.** A parallel array has to be held
together by a length rule, and the shape is the one the surrounding ecosystem
has already backed away from — `enumNames` is non-standard and deprecated in
JSON Schema tooling, and where an extension is used in practice it is a mapping
keyed by the value, for exactly this reason. A mapping also inherits duplicate
rejection from the `parser` phase (`ERR_DUPLICATE_KEY`) rather than needing a
rule of its own.

**In `ui`, not `schema`, and this is decisive rather than a preference.**
Blueprint §5.2 decides whether two components declaring one input agree by
comparing their `schema` blocks and deliberately not their `ui` blocks. Labels
inside `schema` would make two components that word one enumeration differently
a rejected composition — `ERR_CONFLICTING_INPUT_SCHEMA` over a difference of
phrasing. In `ui` the first node's wording wins, which is the presentation
decision §5.2 already says it is making. The same argument rules out the
apparently cleaner move of making `enum` itself a list of `{value, title}`
objects, which the window would otherwise have made free.

`COMP-UI-005` holds the two together: every key must name a member,
`ERR_UNKNOWN_ENUM_MEMBER`, `semantic` — because relating a mapping's keys to a
sibling array's items is not something JSON Schema expresses. The reverse is
deliberately legal: a member with no label is offered as it is spelled, which is
what every document written before the field existed already does. The rule is
written now because it is free only while the field has never shipped.

Recorded plainly: `enum` is used **zero times** in the measured corpus, so this
is the one addition here arguing from design rather than from evidence.

### 5. A platform default names its kind

`platformDefault` gains a REQUIRED `type`, with one member, `SELF_ADDRESS`.
`source` and `endpoint` keep their names and their meanings inside it.

**This is the one narrowing, and the reason it is taken now.** A discriminator
introduced later is a required field introduced later, which is breaking on
ordinary terms; introduced inside the window it costs maintainer approval and a
declaration. That is the asymmetry ADR 0013 states as "adding members stays free
forever; withdrawing one is free now and never again", applied to the tag rather
than the member. It is REQUIRED rather than defaulted for the reason
`COMP-GEN-001` gives for `isSensitive`: a discriminator a document may leave out
is one two implementations may read differently.

One kind exists, so this is a tagged object rather than a `oneOf`. A second
becomes a branch beside it, and a document written against this one still
validates — which is what the tag buys and the whole of what it buys today.

**The field keeps its name.** `valueFrom` was proposed and is unavailable:
`ComponentOutput.valueFrom` is already a `DECLARED`/`DERIVED` string enum in
this family, and reusing the word for a discriminated object gives one name two
shapes. `platformDefault` accurately names all six live uses, and
[ADR 0005](0005-platform-divergence-reconciliation.md) §2 warns against spending
a working capability "to hold options open for rules nobody has proposed".

**Rejected: collapsing `suppliedBy`, `generator` and `platformDefault` into one
value-source union.** [ADR 0010](0010-runtime-divergence-reconciliation.md) §5
gestures at one — "Phase 7's value-source union makes that structural rather
than a rule to remember" — and it is tempting: it would make §6.1's obligations
structural and collapse blueprint §5.3's five-condition table to three.

It also makes the corpus's dominant case unrepresentable. `n8n.n8nHost` and its
two siblings carry `suppliedBy: USER` **and** a `platformDefault` at once: the
platform fills it, and the user may type over it for a custom domain. All six
platform-derived inputs in the catalog are that shape, and "auto-configured,
override only for a custom domain" is the sentence the whole proposal exists to
make expressible. These are two orthogonal axes — who may type it, and what fills it
when nobody does — and a `oneOf` asserts exclusivity between branches that are
not exclusive. Two further objections stand on their own:
`tools/src/effective.ts` resolves `$ref`, `allOf` and the nullable `anyOf` idiom
and reports anything else unresolvable, which
[ADR 0008](0008-effective-values.md) requires of it, and `suppliedBy` carries a
`default` that is actively resolved today; and ADR 0010 §5's rule is a blueprint
rule about a component document, which no shape in either schema makes
structural.

Recorded for whoever reads ADR 0010 next: **"Phase 7" resolves to nothing in
this repository.** It is the only occurrence of the phrase in `docs/`,
`specifications/` or `.github/`, and `check:links` sees Markdown links rather
than prose references. An accepted ADR is leaning on a plan that is not written
down here.

What the shape does close is the gap §6.1 recorded rather than decided —
"`suppliedBy` is unconstrained by `platformDefault` in v1". A `CONNECTION` input
may carry neither platform-side source, and a `generator` may not sit beside a
platform default: minting a value and deriving one are two answers to one
question. A gap the shape can close is not one to describe.

### 6. A derived parameter carries what it was always said to carry

Blueprint §5.1 derived `schema`, `ui` and `isRequired`, while the paragraph
above it argued that a `generator`-carrying input **is** derived so a client can
say "three secrets will be generated for you". It then did not carry
`generator`, so that sentence was false: the parameter arrived as an ordinary
field with nothing to say it with. `BlueprintParameter` had the property and the
prose never put anything in it.

The list becomes five — `schema`, `ui`, `isRequired`, `generator`,
`platformDefault` — and `BlueprintParameter` gains the `platformDefault`
counterpart it never had. §5.3's guarantee test gains the matching branch: a
parameter carrying a platform default guarantees a value, or an override that
does supply the value would fail to cover the input it satisfies and the
blueprint would be rejected for an omission that is not one.

## Alternatives considered

**A `ui.widget` enum**, as `react-jsonschema-form` and Backstage's scaffolder
use. More expressive than everything above, and rejected because it makes
presentation a second declaration of the same fact: `type: STRING` beside
`widget: TIMEZONE` is a document saying a value is free text and saying it is a
timezone, with nothing to decide which is wrong. The cost is real and is named
rather than argued away — a genuinely presentational choice with no semantic
counterpart, "render this enum as radio buttons", is inexpressible and stays
inexpressible. Component `structural/048` makes the decision executable.

The proposal defended this by saying `format` makes validation and rendering
"the same statement seen from two sides". That half does not hold: §6.3 records
that no phase tests a value against its schema, and §7.2 that no Musher schema
uses the JSON Schema `format` keyword, so a `format` member is exactly as
unenforced today as a `widget` member would be. The decision stands on the
single-declaration argument alone, which is enough.

**`minimum` and `maximum` on `NUMBER`.** ADR 0013 chose one numeric type partly
on the reasoning that an author "writes the constraint rather than reaching for
a second type", and the only constraint available is a regular expression over a
number's string form: there is no way to say "between 1 and 65535". That is a
real gap and it is a value-shape question rather than an install-form one. Left
for a proposal of its own rather than folded in here.

**Giving the derivation clause a requirement identifier**, which the proposal
asked for. Rejected in §1: it would add a second permanently-`UNPINNED` entry,
turning a recorded anomaly into a pattern and moving the explanation of the
coverage line out of prose and into a TypeScript map.

## Consequences

**A document can now say what it means well enough to be rendered.** The two
hand-rolled timezone fields become `format: TIMEZONE`, the six platform-derived
inputs become fields a client can mark as filled-in-for-you, and an enumeration
can reach a buyer in words. Eleven of the thirteen curated items already require
zero typed input; this is the remaining distance to a form that reads well.

**One narrowing, and the window pays for it.** Every `platformDefault` in the
corpus, in the examples, and in the conformance trees gains `type:
SELF_ADDRESS`. Under ADR 0005 §1 that costs no `v<N>` directory and no migration
note, and it costs maintainer approval and a breaking trailer. After the first
tag it would have cost a major version.

**`musher-dev/catalog` fetches the bundles from `main` unpinned**, on every
push, every pull request and a daily cron, deliberately — its workflow says the
point is to learn when a spec change stops accepting an item. It will go red on
this merge until its thirteen items gain the tag, and that is the mechanism
working rather than failing.

**Six new requirement identifiers and one new diagnostic.**
`ERR_UNKNOWN_ENUM_MEMBER` is the first `semantic` code component §8 declares
that another family also reports, since a blueprint parameter carries the same
`ui` block; §8's closing sentence names that exception rather than the row being
restated in blueprint §7.

**A renderer clause is a rule the corpus cannot check.** §6.4's derivation is
normative and untestable here, exactly as listing §4.1's is, and both are
recorded as such. What is testable is that the vocabulary it reads is closed and
that a document cannot declare a control instead — which is what the fixtures
pin.
