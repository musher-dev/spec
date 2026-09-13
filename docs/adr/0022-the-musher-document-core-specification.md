# ADR 0022: The Musher Document Core Specification

- **Status:** Accepted
- **Date:** 2026-09-13
- **Refines:** [ADR 0001](0001-canonical-repository-architecture.md) §2
- **Refines:** [ADR 0002](0002-conformance-case-trees.md) §2
- **Extends:** [ADR 0003](0003-controlled-vocabulary-placement.md) §2
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1
- **Relies on:** [ADR 0021](0021-repository-organized-around-the-family-version.md)

## Context

[ADR 0001](0001-canonical-repository-architecture.md) §2 gave the three
families one envelope and expressed it per family, so that each bundle stays
self-contained. It did not say where the rules *about* that envelope live. They
landed in component, and component has been the base specification ever since
without being named as one.

Every other family reaches its shared rules by citing component. Blueprint §2
and listing §2 both say that "all envelope rules in
[component §2](../../specifications/component/v1/spec.md#envelope), and the
version compatibility rules in
[component §3](../../specifications/component/v1/spec.md#compatibility), apply
identically". Both §6s are "as defined in component §7". Both §7s open "the
codes in [component §8](../../specifications/component/v1/spec.md#diagnostics)
apply. This family adds:". Both §10s open "Component §11 applies in full".
Component §7.1 says the YAML profile "governs all three families", and
component §8 calls its `parser` and `structural` rows "the shared envelope
registry". Four defects follow from that arrangement.

**A reader cannot tell which of component's rules are component's.**
`COMP-ENV-002` says `kind` "MUST be `COMPONENT` for this family", and
blueprint's `structural-002-wrong-kind` pins exactly that ID, for a document
whose `kind` must be `BLUEPRINT`. `COMP-ENV-007` states a rule for the whole
contract, then lists the one placement it allows in component. It does not
list blueprint's `size: null`, which
[blueprint §4.3](../../specifications/blueprint/v1/spec.md#node-compute) has to
defend separately.

**The item directory belongs to one of its users.**
[Blueprint §3.1](../../specifications/blueprint/v1/spec.md#item-directory)
defines the item root as "the directory containing `blueprint.yaml`". A
`COMPONENT` item has no such file, so
[listing §3.1](../../specifications/listing/v1/spec.md#component-item) defines a
second item root and adds "the two definitions agree wherever both apply". The
rules measured against that root are declared twice. `BP-ID-001` and
`LIST-ID-001` have the same text. `BP-ID-002` is unconditional, while
`LIST-ID-002` applies "where the item holds a blueprint". Both families
declare `ERR_SLUG_MISMATCH` and `ERR_VERSION_MISMATCH`, and the two
`ERR_VERSION_MISMATCH` rows differ in meaning. `conformance.ts` refuses an ID
declared twice ("one ID names one rule"), but nothing refuses a code declared
twice.

**The parser corpus was copied, and the copies have drifted.** Component has
thirteen `parser` cases, covering all twelve `COMP-YAML` rules. Blueprint and
listing have four each, and together they pin only three of those rules, so
nine of the twelve rules that "govern all three families" are never run through
a blueprint or listing pipeline. The copies that do exist differ in comments and
bodies, and twelve parser cases across the three corpora cite `#envelope` while
pinning a `COMP-YAML` ID declared under `#yaml-profile`.

**The tooling hard-codes the arrangement.** `tools/src/conformance.ts` declares
`BASE_FAMILY = 'component'`. `registryFor` builds a family's registry from its
own table plus the *whole* of component's. So a listing fixture may declare
`ERR_UNPINNED_IMAGE`, and a fourth family would inherit every `semantic` and
`capability` code component has, because the base was never limited to the
rows that are actually shared.

### Why now

`git tag -l` is empty and `published.json` records `"releases": {}`, so the
ground of [ADR 0005](0005-platform-divergence-reconciliation.md) §1, that
nothing published means nothing to migrate from, holds for every family. Moving
a requirement retires its ID, and a retired ID is a broken link in every
downstream test and docstring that cites it. Today that costs the downstream
updates the table in §3 maps. After the first tag it would also strand IDs that
a released specification had published, which no later edit can take back.
[ADR 0021](0021-repository-organized-around-the-family-version.md) already
moves every path in this pass, and one reorganization is cheaper for
downstream repositories than two.

## Decision

### 1. A base family, `core`, that defines no `kind`

A fourth directory, `specifications/core/v1/`, holds the **Musher Document Core
Specification**. It is a family in the repository sense: it has its own
`spec.md`, its own corpus and its own release train, tagged `core/vX.Y.Z` in
the shape ADR 0001 §4 gives every family. It is *not* a family in ADR 0001 §2's
sense, because it matches no `kind` discriminator. No document declares it,
there is no `kind: CORE`, and it gets no entry in the editor catalog, which
binds file names to schemas when core has neither.

Its requirement IDs are `CORE-<AREA>-NNN`, which fits the requirement grammar
the tooling already enforces. That refines ADR 0001 §2: there are three kind
families and one base they cite, and the envelope is still expressed per
family, as §5 below keeps it.

The name follows the established precedent for a normative base that other
specifications cite: CNAB Core, JSON Schema Core, and the CloudEvents core
specification that its bindings and formats build on. Alternatives considered
records why the other names lost.

### 2. What may enter core

A rule moves to core only when **all three** of these hold:

1. **It can be stated without naming a kind.** A rule that names `COMPONENT`
   cannot bind a family that has no components.
2. **At least two families apply it.** A rule only one family applies is that
   family's rule under another name. Putting it in core rebuilds the defect
   this ADR removes, and makes every other family read it.
3. **Within the major version, it can only grow by addition.** A core release
   reaches every family at once. Narrowing a core rule is a new major of every
   family, so a rule whose tightening is foreseeable is not ready for core.

This is the *core* admission test. It is unrelated to the vocabulary admission
test in GOVERNANCE.md. Core §1.2 restates it informatively. This ADR is where
it is decided.

The test excludes something that looks shared. The value-shape vocabulary is
applied by component and by blueprint, so it passes the second condition. It
fails the first, because it is component contract grammar: it is the grammar of
the `schema` block of a component input, a block only a component defines.
Blueprint applies it only because a blueprint carries that component block, so
stating the vocabulary without naming a component would leave it describing
nothing. It stays in component §6.3, where
[ADR 0013](0013-value-shape-vocabulary.md) §6 put it, and blueprint reaches it
through the dependency declared in §4. `ERR_UNKNOWN_ENUM_MEMBER` stays in
component for the same reason: it belongs to the `ui` block component defines.

### 3. What moves, and what stays

Everything that moves keeps its text. Only its links change, with the
exceptions this section names.

| Core v1 | Anchor | Content | From |
|---|---|---|---|
| §1, §1.1, §1.2 | `#scope`, `#bindings`, `#admission` | What core is; the parameters a family binds; §2 above | new |
| §2 | `#envelope` | `CORE-ENV-001`…`007`, the `apiVersion` note | component §2 |
| §3 | `#compatibility` | Version compatibility | component §3 |
| §4.1 | `#item-directory` | Catalog item, item root, item document; no directory means no item root | blueprint §3.1, listing §3 and §3.1 |
| §4.2 | `#item-identity` | `CORE-ITEM-001`, `CORE-ITEM-002`, with listing's "two halves" rationale | blueprint §3, listing §3 |
| §5.1 | `#label-grammar` | `^[a-z][a-z0-9-]{0,61}[a-z0-9]$`, a named grammar with no ID | blueprint §4, component §5.5 |
| §6, §6.1, §6.2 | `#validation-layers`, `#yaml-profile`, `#format-policy` | The four phases, `CORE-YAML-001`…`012`, the `format` keyword | component §7 |
| §7 | `#diagnostics` | The ten `parser` codes, the six `structural` codes, `ERR_SLUG_MISMATCH`, `ERR_VERSION_MISMATCH` | component §8, blueprint §7, listing §7 |
| §8, §8.1 | `#conformance`, `#core-corpus` | Profile claims, and the core corpus (§6 below) | component §9 |
| §9 | `#editions` | The release line, and the citation rule (§7 below) | new |
| §10 | `#known-debt` | Gaps core records | new |
| §11 | `#security` | Parsing, regular expressions, diagnostics, schema retrieval, paths inside an item | component §11, blueprint §10 |

**What stays:**

- component §4–§6, including value shapes (`COMP-VAL-*`), install form
  (`COMP-UI-*`, `ERR_UNKNOWN_ENUM_MEMBER`), and the endpoint and
  environment-variable grammars
- component's rules on images, build sources and external addresses in §11
- `BP-ID-003`, and blueprint's containment, graph-traversal and
  published-reference rules
- listing's COMPONENT-item reasoning, media rules and description profile

**Texts that name a kind are generalized; the substantive ones are:**

- `CORE-ENV-002` requires the constant the family binds.
- `CORE-ENV-007` requires a family to name each field that accepts `null`.
  Component keeps its `schedule: null` paragraph.
- `CORE-ITEM-002` requires every item document in an item to carry the same
  `metadata.revision`. With one item document, that is trivially true, which
  keeps listing's reasoning that a `COMPONENT` item's revision is bound to
  nothing. It also changes a meaning, deliberately: `BP-ID-002` was
  unconditional, so a blueprint item with no `listing.yaml` failed it, and that
  item now passes. Blueprint §3 records the gap as one v1 does not constrain,
  as listing §3 already does for a `BLUEPRINT` listing with no blueprint.
- `ERR_VERSION_MISMATCH` has one meaning: `metadata.revision` disagrees with
  another item document in the same item.
- Component §7.1's "governs all three families" becomes "governs every family
  built on this document".
- Component §7.2's sentence separating the keyword from component's `format`
  field becomes one separating it from any field named `format` a family
  defines.
- Blueprint §3.1's "the directory containing `blueprint.yaml`" becomes the
  directory containing an item document, defined once in core §4.1.
- Listing §3.1's "the two definitions agree wherever both apply" has nothing
  left to reconcile: core §4.1 is the one definition, and the item documents of
  one item are siblings under it.
- Blueprint §10's containment paragraphs, written about a `componentRef`
  reference, become core §11's "Paths inside an item", written about any path a
  document names. That is a deliberate widening. Listing §10 adopted only the
  symlink and resolved-location requirements, and its media paths are now also
  held to the rule that an implementation MUST NOT follow a path outside the
  item root even when the target is readable, as every family's paths are.

**Requirement IDs.** Old IDs are retired and never reused.
`musher-dev/platform` and `musher-dev/catalog` cite them in code and tests, and
this table is their migration:

| Old | New | Notes |
|---|---|---|
| `COMP-ENV-001`…`006` | `CORE-ENV-001`…`006` | Same numbers; `002` generalized |
| `COMP-ENV-007` | `CORE-ENV-007` | The family names its `null` fields |
| `COMP-YAML-001`…`012` | `CORE-YAML-001`…`012` | Same numbers |
| `BP-ID-001`, `LIST-ID-001` | `CORE-ITEM-001` | Slug equals the item directory name |
| `BP-ID-002`, `LIST-ID-002` | `CORE-ITEM-002` | Item documents agree on `metadata.revision` |
| `BP-ID-003` | `BP-ID-003` | Unchanged |

Component keeps stub sections under its `#compatibility` and
`#validation-layers` headings, and its §7 stub carries `#yaml-profile` and
`#format-policy` as inline anchors. [ADR 0003](0003-controlled-vocabulary-placement.md)
and [ADR 0013](0013-value-shape-vocabulary.md) link those anchors, and a stub
keeps each link pointing somewhere true. A stub MUST NOT keep a retired
requirement anchor, because a retired ID that still resolves reads as a live
one.

### 4. A family binds core's parameters and declares its dependencies

Each family's §2 becomes a bindings table:

| Core parameter | Component | Blueprint | Listing |
|---|---|---|---|
| `kind` | `COMPONENT` | `BLUEPRINT` | `LISTING` |
| `metadata` section | §4 | §3 | §3 |
| Fields accepting `null` | `schedule` (§5) | `size` (§4.3) | none |
| Item document | none; it sits inside an item | `blueprint.yaml` | `listing.yaml` |

Each §2 is followed by a **Normative dependencies** table. Every family lists
core v1, and blueprint also lists component v1. Tooling reads this table: a
family's registry is its own codes, plus core's, plus those of its declared
dependencies. That replaces `BASE_FAMILY`. A family re-declaring a core code
fails the check. Listing stops reaching `ERR_UNPINNED_IMAGE`, and blueprint
still reaches `ERR_UNKNOWN_ENUM_MEMBER` for the reason it should.

A family narrows core where it says so and relaxes core nowhere. Every citation
of core MUST be a link. `tools/src/prose.ts` turns a bare "§6.1" into a link to
the *current* document, so an unlinked "core v1 §6.1" would silently point at
the family's own §6.1.

This is [ADR 0003](0003-controlled-vocabulary-placement.md) §2 applied to
rules, generalizing what ADR 0013 §6 did for one sibling `spec.md`: a family
cites the rule and does not restate it.

### 5. Core ships no schema in v1

A core schema would have to take one of two shapes, and both are worse than
none.

- **A closed `kind` enum.** Every new family would then wait on a core release
  to add its member. That turns adding a family, which GOVERNANCE.md already
  treats as a structural change needing an ADR, into a core compatibility
  event as well.
- **An open `kind` string with open `metadata` and `spec`.** This asserts
  nothing that each family's own `kind` constant, reported as
  `ERR_WRONG_KIND`, does not already assert. It also breaks `lint.ts`'s rule
  that every object says `"additionalProperties": false`, which exists because
  the envelope rule requires unknown properties to be rejected at every level,
  and an exemption written for the first schema that wants one would be the
  rule's end rather than its exception.

Either shape would then have to be consumed. ADR 0001 §2 declined a
cross-family `$ref`, and §3 forbids a remote one, so the schema would be inlined
into three bundles that already state the envelope exactly: three copies of a
fourth artifact, giving no bundle anything it lacks. Dispatch by `kind` needs
no schema either; it is one read after parsing.

ADR 0001 §2 therefore stands, and it gains enforcement. A lint check asserts
each family root has exactly `specVersion`, `kind`, `metadata` and `spec`, all
required, with `"additionalProperties": false`. It also asserts that
`specVersion` enumerates the family's major and that `kind` is the constant
the §2 bindings table names. A `schemas/` directory under
`specifications/core/` fails the same check. Adding a core schema later is
additive, and core §10 records it as open, together with the other gaps this
ADR leaves: no diagnostic for an unknown `kind` before a family is chosen, and
a label grammar that is named but carries no ID.

### 6. The core corpus is parser-phase only

A `structural` case needs a schema, and core has none. An item-identity case
needs a document of some kind inside a directory. So core's corpus holds only
`parser` cases, and an adapter runs each through its parser alone.
`expected: pass` means the parser accepts the document, and no later phase
runs. A document need not be a valid envelope, because no later phase reads it.
Where it carries a `kind`, that value is `COMPONENT` and has no effect, and an
adapter MUST NOT dispatch on it. The parser runs before
dispatch, so an implementation covering several families runs the core corpus
once.

In practice:

- Component parser 001–013 move to core with their names and numbers. Every
  `clause` now cites core `#yaml-profile`, and the BOM and CRLF bytes of 012
  and 013 are left untouched.
- Blueprint and listing parser 002–004 are deleted. Each family keeps one
  smoke case, `parser-001-reject-duplicate-keys`, pinning `CORE-YAML-006`,
  which proves that family's pipeline runs the profile at all. Component gets
  a copy.
- Structural 002–005 in all three corpora, component structural 023 and 057,
  blueprint semantic 003 and 004, and listing semantic 002 and 003 are
  re-pinned to core clauses and IDs. That ends the `#envelope`-cites-`COMP-YAML`
  mismatch as a side effect.

**A claim to conform to a family release covers two sets of cases.** One is the
release's own corpus. The other is the core corpus at the core edition that
release records (§7). An implementation MUST pass both under its declared
profile. It MAY also run a later core v1 corpus, and MUST NOT substitute one
for the other. A skipped case is still never a passed one.

This changes the fixture contract, and refines
[ADR 0002](0002-conformance-case-trees.md) §2: a `case.yaml` asserts there is
no item root, and a core `case.yaml` also asserts there is no kind. The
item-root definition ADR 0002 cites from blueprint §3.1 now lives in core §4.1.

### 7. Families cite the line, and releases record the edition

A family's prose cites core by its major line, "core v1 §N", always as a link.
Citing an exact edition in prose would turn every core patch release into a
prose edit in three families.

The exact edition is recorded with each kind family release instead, as
`requires.core`, together with the core `spec.md` and corpus extracted from
that edition's tag. A conformance claim therefore names two corpora that both
exist and that were tested together.

**A kind family release is gated while core has unreleased releasable
changes.** A core commit is releasable when its type is one release-please's
changelog shows (`feat`, `fix` or `docs` in
`.github/release-please/config.json`), or when it is breaking. A kind family
built against a core with such changes pending would record an edition that
does not describe the rules it was tested against.

A non-releasable core commit only warns, and this is not leniency.
release-please opens no core release for a type its changelog hides, so a
blocking `chore(core)` would hold every kind family until someone manufactured a
releasable core commit: a deadlock on the one change that alters no rule.

The ledger fields, the archive contents, and the checks that enforce this are
[ADR 0023](0023-published-bytes-are-immutable-release-assets.md)'s.

## Alternatives considered

**Name component as the base.** Keep the arrangement and write down that
component §2, §3, §7, §8 and §9 are shared. This costs the least now and is
rejected because every defect in Context survives it, and component's title and
scope would still say "one reusable, versioned graph node" while its releases
shipped listing's parser rules.

**`shared/` or `common/`.** Both name a relationship rather than a contract.
By convention both hold schema fragments or vendored schemas, which is exactly
what a reader would go looking for there, and a cross-family `$ref` is what
ADR 0001 §2 declined.

**`document/`.** It is accurate, but it sits in a directory beside
`component/`, `blueprint/` and `listing/` and reads as a fourth kind. The next
question would be what `kind: DOCUMENT` means.

**Inline core into each family's `spec.md` at build time.** This keeps one
source and publishes three self-contained documents. It is rejected because
each `CORE-*` ID would then be declared three times, which is the duplicate
declaration `conformance.ts` refuses. A family release would also absorb core
changes silently, with no edition recorded anywhere.

**No core release train; core ships only inside family releases.** A core
change would then need three coordinated family releases to reach anyone,
which is the lockstep ADR 0001 §2 rejected when it rejected a single `catalog`
family.

**Keep each family's full parser corpus.** Rejected on the drift recorded in
Context. The single smoke case keeps the one thing a per-family copy proved,
which is that the family's pipeline runs the parser.

**Keep `BP-ID-*` and `LIST-ID-*` as aliases of the core IDs.** Two names for
one rule is the defect the ID index exists to refuse. An alias would also turn
"retired" into "retired, except here".

## Consequences

**There are four release trains, and one of them can hold the other three.** A
kind family release now waits on any pending releasable core change. That is
the point of the gate, and it is also friction nobody had before.

**Core minor releases reach every family at once.** The add-only condition in
§2 is what makes that safe, and nothing else does. After the first core tag, a
core rule that needs tightening is `v2` of core and a new major line cited by
every family.

**Downstream citations break, deliberately.** Every `COMP-ENV`, `COMP-YAML`,
`BP-ID-001`, `BP-ID-002`, `LIST-ID-001` and `LIST-ID-002` citation in
`musher-dev/platform` and `musher-dev/catalog` dangles until it is updated. The
table in §3 is the whole of the migration. Renaming an ID rejects no previously
valid document and changes no `ERR_*` code or phase, so the change carries no
breaking marker; the retirement is announced by the ID table in this ADR and by
the core changelog. The extraction lands in the reorganization pull request,
whose `BEGIN_COMMIT_OVERRIDE` block, recorded in
[ADR 0021](0021-repository-organized-around-the-family-version.md), gives core
its `feat(core)` entry.

**Accepted ADRs keep resolving, one hop short.** Links from ADR 0003 and
ADR 0013 into component still resolve, but they land on a one-paragraph stub
that points to core. Under ADR 0021's link-maintenance rule, those link targets
may be updated to point at core directly.

**A conformance report grows a field.** A claim now names the core edition it
ran, and a harness pins two corpora rather than one.

**Family-level parser coverage is one case.** An implementation with a
different parser per family runs the core corpus once per parser. The smoke
case catches a missing profile. It does not catch a partial one.

## Follow-ups

1. Update the retired IDs in `musher-dev/platform` and `musher-dev/catalog`
   from the table in §3.
2. The label grammar is written literally in all three schemas' sources.
   Consider a lint comparison that holds the copies together.
