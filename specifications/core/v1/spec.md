# Musher Document Core Specification — Specification v1

**Status:** Draft (pre-stable)
**Family:** `core`

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when, and only when, they
appear in all capitals, as shown here.

> **What is normative.** This document defines the behaviour every Musher
> document family shares. It publishes no JSON Schema of its own
> ([§10](#known-debt)): each family's bundle is the executable form of that
> family's structural validity, and states this document's envelope rules for
> that family's documents. The [conformance corpus](../../../docs/conformance.md)
> — this document's own, and each family's — is the executable form for
> observable outcomes. This document, the corpora, and each family schema where
> it states a rule of this document are normative, and none is permitted to
> disagree with another. Examples, generated documentation, and validator
> message text are informative.
>
> A disagreement between two normative artifacts is a defect in this
> specification and blocks a release. Until it is fixed this document governs —
> but that is how to read a broken contract, not a licence for a schema or a
> fixture to be wrong.

---

## <a id="scope"></a>1. Scope

The **Musher Document Core Specification** states the rules every Musher
document family shares: the document envelope, version compatibility, the
catalog item, the identifier grammars more than one family uses, the validation
layers and the YAML profile, the shared diagnostic codes, what a conformance
claim covers, and the security considerations every document raises.

It defines no `kind`. No document declares this specification, and no document
is validated against it alone. A document belongs to a family — today
[component](../../component/v1/spec.md), [blueprint](../../blueprint/v1/spec.md)
or [listing](../../listing/v1/spec.md) — and that family's specification applies
this one, binding the parameters [§1.1](#bindings) leaves open.

A family specification cites a clause of this document by its major line and
section, as `core v1 §6.1`, and always as a link to the clause's anchor
([§9](#editions)).

**Out of scope for this document**

- Every field inside `metadata` and `spec` → the family specification
- The JSON Schema a document is validated against → the family's bundle
- Runtime state, instances, and endpoints → the Musher API

### <a id="bindings"></a>1.1 Bindings

This document leaves some parameters to the family that applies it. A family
specification MUST bind each of them in its §2, in a table whose first column is
headed "Core parameter":

| Core parameter | What the family states | Read by |
|---|---|---|
| `kind` | The constant its documents declare. | [`CORE-ENV-002`](#CORE-ENV-002) |
| `metadata` | The section defining its `metadata` object. | [`CORE-ENV-003`](#CORE-ENV-003) |
| Fields accepting `null` | Each field that accepts `null`, with the section that justifies it, or that there are none. | [`CORE-ENV-007`](#CORE-ENV-007) |
| Item document | The file name its document takes at an item root, or that its documents sit inside an item rather than naming one. | [§4.1](#item-directory) |

A family specification MUST also declare its **normative dependencies**, in a
table headed "Normative dependencies" that follows the bindings table and names
each specification whose rules the family applies, with the major line it
applies. Every family names core. A family that applies a rule another family
defines names that family too. A family's diagnostic registry comprises its own
table, core's ([§7](#diagnostics)), and those of the families it declares as
dependencies. Tooling reads the table, so it stays a table.

A family specification narrows this document where it says so and relaxes it
nowhere.

### <a id="admission"></a>1.2 Admission

This section is informative. The test is decided in
[ADR 0022](../../../docs/adr/0022-the-musher-document-core-specification.md) §2,
and restated here so a reader proposing a rule can apply it.

A rule belongs in this document only when **all three** of these hold:

1. **It can be stated without naming a kind.** A rule that names `COMPONENT`
   cannot bind a family that has no components.
2. **At least two families apply it.** A rule only one family applies is that
   family's rule under another name.
3. **Within the major version, it can only grow by addition.** A release of this
   document reaches every family at once, so narrowing one of its rules is a new
   major of every family.

A rule that looks shared can still fail the first condition. Component's value
shapes are applied by component and by blueprint, and they stay in
[component §6.3](../../component/v1/spec.md#value-schema): they are the grammar
of a block only a component defines, and blueprint reaches them through its
declared dependency on component.

## <a id="envelope"></a>2. Document envelope

Every Musher specification document shares one envelope:

```yaml
specVersion: v1
kind: <KIND>
metadata: { … }
spec: { … }
```

| ID | Field | Requirement |
|---|---|---|
| <a id="CORE-ENV-001"></a>`CORE-ENV-001` | `specVersion` | REQUIRED. Declares the document-format compatibility family, independent of any API URL version. |
| <a id="CORE-ENV-002"></a>`CORE-ENV-002` | `kind` | REQUIRED. MUST be the constant the family specification binds ([§1.1](#bindings)). |
| <a id="CORE-ENV-003"></a>`CORE-ENV-003` | `metadata` | REQUIRED. Identity. |
| <a id="CORE-ENV-004"></a>`CORE-ENV-004` | `spec` | REQUIRED. The definition itself. |

<a id="CORE-ENV-005"></a>**`CORE-ENV-005`** — Unknown properties MUST be
rejected with `ERR_UNKNOWN_FIELD` at every level, not only at the root of the
envelope. A misspelled field is an error, never a silently ignored one —
including when the misspelled field is optional, where ignoring it would
silently substitute the default. A property that *is* defined, by a schema
release the validator does not hold, is the same error for a reason
[§3](#compatibility) gives.

<a id="CORE-ENV-006"></a>**`CORE-ENV-006`** — A validator encountering a
`specVersion` it does not support MUST reject the document with
`ERR_UNSUPPORTED_SPEC_VERSION` and MUST NOT attempt a best-effort
interpretation.

<a id="CORE-ENV-007"></a>**`CORE-ENV-007` — an optional field is omitted,
not written `null`.** A field accepts `null` only where `null` means something
omission does not, and a family specification names each field that accepts
`null` ([§1.1](#bindings)). A field written `null` outside those places is
rejected in the `structural` phase with `ERR_INVALID_TYPE`. This rule is here
rather than beside each field because it is a property of the whole contract: a
three-state field — absent, `null`, present — modelling a two-state idea is
three states in every SDK generated from a family's schema, forever, and nothing
reads the third.

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
Message text is not normative ([§7](#diagnostics)), so this is a recommendation
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

## <a id="items"></a>4. Items

Some rules are about a document's surroundings rather than its contents: that
its slug matches the directory holding it, that two documents in one directory
agree, that a path stays inside the directory. This section defines those
surroundings once.

### <a id="item-directory"></a>4.1 The item directory

A document does not always travel alone. Documents that belong together — a
blueprint and its sibling listing, for example — belong to a **catalog item**:
one directory holding one deployable thing.

An **item document** is a document whose file name its family specification
binds ([§1.1](#bindings)). The directory containing an item document is the
**item root**. It is what [§4.2](#item-identity)'s rules are measured against,
and what a family's rules about paths inside an item are measured against.

**Item documents are siblings.** An item holding more than one item document
holds them in the same directory, so the directory containing one is the
directory containing the others, and an item has one item root however many
item documents it holds. A document whose family names no item document sits
inside an item rather than at its root, and has no item root of its own.

**A document with no directory has no item root.** Every rule measured against
an item root needs one, so an implementation handed a document rather than a
directory MUST NOT report any of them. It has not been given the means to check,
and a diagnostic it cannot substantiate is worse than a silence.

### <a id="item-identity"></a>4.2 Item identity

Two rules bind an item's documents together. Both are `semantic`, both are
measured against the item root [§4.1](#item-directory) defines, and both read
fields the item document's family defines in its `metadata`.

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="CORE-ITEM-001"></a>`CORE-ITEM-001` | An item document's `metadata.slug` MUST equal the item directory name. | `ERR_SLUG_MISMATCH` |
| <a id="CORE-ITEM-002"></a>`CORE-ITEM-002` | Every item document in an item MUST carry the same `metadata.revision`. | `ERR_VERSION_MISMATCH` |

A document handed over with no directory has no item root, and
[§4.1](#item-directory) says what that means for both rules.

**The item documents are one item's halves.** A listing whose revision has
moved ahead of its blueprint describes something other than what would be
installed — this release's storefront copy over last release's graph. The rule
is what keeps "read about this" and "install this" the same thing.

**An item holding one item document satisfies `CORE-ITEM-002` trivially.** The
rule pins an item's documents to each other, so it takes two, and where an item
holds one there is no second operand — not a different one. A document inside
the item that is not an item document is not that operand either; what its
revision counts is its own family's to say.
[Listing §3](../../listing/v1/spec.md#identity) records what that means for an
item whose only item document is a listing.

## <a id="grammars"></a>5. Identifier grammars

A grammar named here is used by more than one family, and is stated once. A
family that uses one cites it, and its schema writes the pattern out in full,
because a bundle is self-contained and a pattern cannot be shared by reference.

### <a id="label-grammar"></a>5.1 The label grammar

A **label** matches `^[a-z][a-z0-9-]{0,61}[a-z0-9]$`: a lowercase letter, then
up to sixty-one lowercase letters, digits or hyphens, then a lowercase letter or
a digit. It is a DNS label, two to sixty-three characters long, and it is the
grammar [ADR 0007](../../../docs/adr/0007-naming-conventions.md) §4 gives an
identifier that is composed into a host name or materialised under its own name.
`metadata.slug`, a blueprint node name and a component volume name all take it.

The grammar carries no requirement ID. The rule a document violates is its
family's rule that a field takes the grammar, and a value outside it is rejected
in the `structural` phase with `ERR_INVALID_VALUE`.

## <a id="validation-layers"></a>6. Validation layers

Structural validation is one layer of four. An implementation MUST apply them
in order and MUST NOT report a later-layer diagnostic before the earlier layers
pass.

| Phase | Enforces | Where it runs |
|---|---|---|
| `parser` | The Musher YAML profile — [§6.1](#yaml-profile). | Client and server |
| `structural` | The family's JSON Schema 2020-12 document. | Client and server |
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

### <a id="yaml-profile"></a>6.1 The Musher YAML profile

Musher documents are written in a **restricted profile of
[YAML 1.2.2](https://yaml.org/spec/1.2.2/)**, not in unrestricted YAML. This
section is that profile, and it governs every family built on this document — a
family specification inherits it rather than restating it.

Every restriction below withholds something YAML 1.2.2 permits. The reason is
uniform, and it is the one [§2](#envelope) gives for rejecting a misspelled
optional field: a document that means different things to different readers, or
that cannot be judged without unbounded work, is not a contract. A feature is
therefore withheld when it is *legal but ambiguous*, not when it is merely
unusual.

**Encoding and framing**

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="CORE-YAML-001"></a>`CORE-YAML-001` | A document MUST be encoded in UTF-8. Malformed UTF-8 is rejected. | `ERR_INVALID_YAML` |
| <a id="CORE-YAML-002"></a>`CORE-YAML-002` | A document MAY begin with a UTF-8 byte order mark. It carries no meaning and MUST be ignored. | — |
| <a id="CORE-YAML-003"></a>`CORE-YAML-003` | Line endings MAY be LF or CRLF, and carry no meaning. | — |
| <a id="CORE-YAML-004"></a>`CORE-YAML-004` | A file MUST contain exactly one YAML document. The `---` and `...` markers MAY be present; a stream carrying more than one document is rejected. | `ERR_MULTIPLE_DOCUMENTS` |

A file holding two documents has no answer to "which one is the document", and
picking the first silently discards a thing the author wrote.

**Structure**

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="CORE-YAML-005"></a>`CORE-YAML-005` | Every mapping key MUST be a string. A numeric, boolean, null, or complex key is rejected. | `ERR_NON_STRING_KEY` |
| <a id="CORE-YAML-006"></a>`CORE-YAML-006` | A mapping key MUST NOT appear twice. | `ERR_DUPLICATE_KEY` |
| <a id="CORE-YAML-007"></a>`CORE-YAML-007` | A document MUST NOT declare an anchor or an alias. | `ERR_ANCHOR_OR_ALIAS` |
| <a id="CORE-YAML-008"></a>`CORE-YAML-008` | A document MUST NOT use a merge key (`<<`). | `ERR_MERGE_KEY` |
| <a id="CORE-YAML-009"></a>`CORE-YAML-009` | A node MUST NOT carry an explicit tag — neither a custom tag (`!secret`) nor a core-schema tag (`!!str`). | `ERR_EXPLICIT_TAG` |

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
| <a id="CORE-YAML-010"></a>`CORE-YAML-010` | Document size | 1 MiB (1 048 576 bytes) | `ERR_DOCUMENT_TOO_LARGE` |
| <a id="CORE-YAML-011"></a>`CORE-YAML-011` | Nesting depth | 64 levels | `ERR_DEPTH_EXCEEDED` |
| <a id="CORE-YAML-012"></a>`CORE-YAML-012` | Scalar length | 64 KiB (65 536 bytes) | `ERR_SCALAR_TOO_LONG` |

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

### <a id="format-policy"></a>6.2 The `format` keyword

This clause is about the JSON Schema **keyword** `format`, not about any field
named `format` a family defines. The two are unrelated: such a field is the
family's, with its own rules, and no schema this repository publishes uses the
keyword at all.

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

## <a id="diagnostics"></a>7. Diagnostics

Diagnostic **codes** and the **phase** at which validation fails are normative.
Human-readable messages are not — implementations in different languages emit
different text and that is expected.

The codes below apply to every document of every family. A family
specification's diagnostics table adds codes to them, and MUST NOT declare one
of them again: a code declared in two tables can be given two meanings, and one
code names one condition.

| Code | Phase | Meaning |
|---|---|---|
| `ERR_INVALID_YAML` | `parser` | The document is not well-formed YAML 1.2, or is not valid UTF-8. |
| `ERR_DUPLICATE_KEY` | `parser` | The same mapping key appears twice. |
| `ERR_ANCHOR_OR_ALIAS` | `parser` | The document declares a YAML anchor or an alias. |
| `ERR_MULTIPLE_DOCUMENTS` | `parser` | The file carries more than one YAML document. |
| `ERR_NON_STRING_KEY` | `parser` | A mapping key is not a string. |
| `ERR_MERGE_KEY` | `parser` | The document uses a merge key (`<<`). |
| `ERR_EXPLICIT_TAG` | `parser` | A node carries an explicit YAML tag. |
| `ERR_DOCUMENT_TOO_LARGE` | `parser` | The document exceeds the size bound in [§6.1](#yaml-profile). |
| `ERR_DEPTH_EXCEEDED` | `parser` | The document nests deeper than [§6.1](#yaml-profile) permits. |
| `ERR_SCALAR_TOO_LONG` | `parser` | A scalar exceeds the length bound in [§6.1](#yaml-profile). |
| `ERR_UNSUPPORTED_SPEC_VERSION` | `structural` | `specVersion` is not a supported value. |
| `ERR_WRONG_KIND` | `structural` | `kind` does not match the family being validated. |
| `ERR_UNKNOWN_FIELD` | `structural` | A property not defined by the schema is present. |
| `ERR_MISSING_FIELD` | `structural` | A required property is absent. |
| `ERR_INVALID_TYPE` | `structural` | A value has the wrong type. |
| `ERR_INVALID_VALUE` | `structural` | A value violates a pattern, enum, or bound. |
| `ERR_SLUG_MISMATCH` | `semantic` | `metadata.slug` disagrees with the item directory name. |
| `ERR_VERSION_MISMATCH` | `semantic` | `metadata.revision` disagrees with another item document in the same item. |

## <a id="conformance"></a>8. Conformance

**A claim to conform to a family release covers two sets of cases**: the
release's own corpus, and the core corpus ([§8.1](#core-corpus)) at the core
edition the release records ([§9](#editions)). An implementation conforms when
it produces the declared outcome for every case in both, and MUST pass both
under its declared profile. It MAY also run a later core v1 corpus, and MUST NOT
substitute one for the other.

Implementations MUST run the fixture corpus in their own CI. Passing a fixture
that is declared to fail is a conformance failure.

An implementation MUST declare the **profile** it claims. Conformance is not a
single claim: `capability` needs an account, a region, and a quota, so an
implementation a user runs locally cannot reach it, and an editor integration
that checks structure is a useful thing to be without being a control plane.
The profiles, and the report shape a claim should take, are defined in
[docs/conformance.md](../../../docs/conformance.md#profiles).

A skipped case is never a passed one. An implementation MUST NOT claim a
profile while skipping any case in a phase that profile requires.

### <a id="core-corpus"></a>8.1 The core corpus

The core corpus is [`specifications/core/v1/conformance/`](conformance/), and it
holds `parser` cases only. A `structural` case needs a schema, and this document
publishes none; a case about an item needs a document of some family inside a
directory.

An adapter runs a core case through its parser alone. `expected: pass` means the
parser accepts the document, and no later phase runs. A core case's document
need not be a valid envelope, because no later phase reads it. Where it carries a
`kind`, that value is `COMPONENT` and has no effect, and an adapter MUST NOT
dispatch on it. The parser runs before a family is chosen, so an
implementation covering several families runs the core corpus once — once per
parser, where it has more than one.

Each family's corpus keeps one `parser` case, `parser-001-reject-duplicate-keys`.
It shows that the family's pipeline applies the profile at all. It does not show
that the pipeline applies all of it, which is what the core corpus is for.

## <a id="editions"></a>9. Editions

This document has its own release line, tagged `core/vX.Y.Z` as each family's
is. One release of it is an **edition**.

**A family cites the line, not the edition.** A family specification cites this
document as "core v1 §N" and never names an exact edition in prose: an edition
in prose would turn every core patch release into a prose edit in every family.
Every citation MUST be a link to the clause's anchor. A section number standing
alone is read as a section of the document it appears in, so an unlinked
`core v1 §6.1` in a family specification points a reader at the family's own
§6.1.

**A family release records the edition.** Each release of a family records the
core edition it was built and tested against, and carries that edition's
`spec.md` and corpus with it. A conformance claim against the release names that
edition ([§8](#conformance)), so the two corpora the claim names both exist and
were tested together. How the edition is recorded, the checks that hold a
family release while this document has unreleased releasable changes, and why
its other unreleased changes only warn, are set out in
[ADR 0023](../../../docs/adr/0023-published-bytes-are-immutable-release-assets.md).

**What a release of this document may change.** This paragraph is informative:
it records this repository's release policy. Within v1, a minor release of this
document adds a clause, a case or a relaxation, and adds a code only for a
condition an earlier v1 edition already rejects. No release rejects a document
an earlier v1 edition accepted — [§3](#compatibility) applied to every family at
once, which is why [§1.2](#admission) admits only rules that grow by addition.
A rule that needs narrowing is core v2, a new line that each family adopts in a
major release of its own.

## <a id="known-debt"></a>10. Known debt

**No core schema.** This document publishes no JSON Schema. Each family's bundle
states the envelope for its own documents, and
[ADR 0022](../../../docs/adr/0022-the-musher-document-core-specification.md) §5
records why neither available shape of a shared schema was worth publishing.
Adding one later rejects no document and is additive.

**No code for an unknown `kind` before a family is chosen.** `ERR_WRONG_KIND` is
reported by a family, against the constant it binds, once that family has been
chosen. An implementation that chooses the family by reading `kind` has no code
for a value that names no family, and this document does not yet say what it
reports.

**The label grammar carries no ID.** [§5.1](#label-grammar) names it, and each
family schema writes the pattern out in full. Nothing but review holds those
copies together, and no case pins the grammar as one rule rather than as each
family's field.

## <a id="security"></a>11. Security considerations

This section is addressed to **implementations**: what a validator, a CLI, or a
control plane must do so that reading an untrusted Musher document is safe.
[SECURITY.md](../../../.github/SECURITY.md) is the separate question of what counts as a
vulnerability *in this repository* and how to report one.

A Musher document is untrusted input. It arrives from a pull request, a
catalog submission, or a `POST` body, and every consideration below assumes its
author is hostile. Each family specification adds what is specific to its own
documents.

**Parsing.** [§6.1](#yaml-profile) is a security boundary as much as an
interoperability one. Aliases are refused because expansion is where a small
document becomes a large one, and the size bound is measured before parsing
because a limit applied after the tree exists is not a limit on the work done to
build it. An implementation MUST enforce all three bounds, and MUST NOT raise
them to accommodate a document that exceeds them.

An implementation MUST NOT resolve YAML tags to host language types. The tag ban
makes this unreachable through a conforming parser, but a parser configured to
construct arbitrary objects from tags is the classic deserialisation
vulnerability, and the ban is not a substitute for choosing a safe loader.

**Regular expressions.** Every `pattern` a Musher schema publishes is free of
lookaround and backreferences, which is what lets it compile under RE2 as well as
under a backtracking engine. An implementation evaluating these patterns on a
backtracking engine SHOULD apply a match timeout regardless: the guarantee is
about the patterns published here, not about any the platform composes with them.

**Diagnostics.** An implementation MUST NOT include resolved configuration values
in a diagnostic message. Diagnostics are logged, attached to pull requests, and
printed in CI output, and a validator that echoes the value it rejected turns a
validation error into a disclosure.

**Paths inside an item.** A path a document names inside its item is a path an
implementation will open, chosen by the document's author. An implementation
MUST decide containment on the **resolved** location rather than on the string:
a path is an escape if what it resolves to lies outside the item root, whether it
got there by `../`, by an absolute path, or by a symbolic link inside the tree.

Symlinks are the case worth stating plainly. A link committed inside an item can
point anywhere the process can read, so an implementation MUST resolve links
before testing containment, and MUST treat a dangling link resolving outside the
root as an escape — containment is a property of the resolved location, not of
whether the target happens to exist. The conformance corpus fixtures this
directly; see [docs/conformance.md](../../../docs/conformance.md#case-trees).

An implementation MUST NOT follow a path outside the item root even when the
resulting file would be readable and would parse. The rule is about what a
reviewer of the item can see: a document that reaches outside the directory being
reviewed brings in something the review did not cover.

**Schema retrieval.** Every published bundle is self-contained: all `$ref`s
resolve inside `$defs`, and no validator needs a network request to evaluate a
document ([README](../../../README.md)). An implementation SHOULD vendor the
schema at an exact version rather than fetching it, and MUST verify what it
fetches if it does — the `.sha256` beside each pinned URL and `published.json`
are there for that. A validator that resolves schemas over the network at
validation time is an SSRF primitive and a runtime dependency on an origin it
does not control.
