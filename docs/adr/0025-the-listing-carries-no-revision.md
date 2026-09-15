# ADR 0025: The listing carries no revision of its own

- **Status:** Accepted
- **Date:** 2026-09-15
- **Refines:** [ADR 0022](0022-the-musher-document-core-specification.md) §3
- **Extends:** [ADR 0007](0007-naming-conventions.md) §1, §2
- **Extends:** [ADR 0003](0003-controlled-vocabulary-placement.md) §4
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

A listing document is the catalog storefront entry for an item: how it is
presented, categorised and discovered. Listing §1 is unambiguous that it
"carries presentation only" and "MUST NOT influence how the workload runs".

It nevertheless carries a number. `metadata.revision` sits on `listing.yaml`
exactly as it sits on `blueprint.yaml`, and
[ADR 0022](0022-the-musher-document-core-specification.md) §3 moved the rule
binding the two into core as `CORE-ITEM-002`: every item document in an item
MUST carry the same `metadata.revision`, on pain of `ERR_VERSION_MISMATCH`.

That rule is the single largest consumer of listing prose. Listing §3 spends
thirty lines on it: why a `COMPONENT` item's listing revision is bound to
nothing, why it is not bound to a component document beneath it, why no
designated primary component is named, and what the rule does not detect.
Core §4.2 carries a further two paragraphs of the same argument, one of which
links back into listing §3 to finish it. None of that prose describes what a
listing *is*. All of it exists to keep one number from disagreeing with a copy
of itself.

A second number on a document that influences nothing is contract surface that
can only ever be wrong. An author maintains it, a reviewer checks it, a
validator compares it, and the best outcome of all that work is that it equals
the number next door.

### Why now

`git tag -l` is empty, `published.json` reads `{"releases": {}, "version": 2}`,
and `.github/release-please/manifest.json` reads `0.0.0` for all four packages.
[ADR 0005](0005-platform-divergence-reconciliation.md) §1's pre-publication
window is therefore open for every family, and it closes for a family the moment
that family's first tag is created. Every decision below rejects a document that
validates today. Each is free now and a new major afterwards, in four families
at once.

## Decision

### 1. The listing carries no revision, and `CORE-ITEM-002` is withdrawn

**`metadata.revision` is removed from the listing document.** A listing's
`metadata` carries `slug` and nothing else. The item's revision is the
blueprint's, and a `COMPONENT` item, which holds no blueprint, has no item
revision at all: its component documents carry their own, which
[component §4](../../specifications/component/v1/spec.md#metadata) already
defines and orders.

**`CORE-ITEM-002` and `ERR_VERSION_MISMATCH` are withdrawn from core.** This
follows from the removal rather than being a second decision. Blueprint and
listing are the only two item documents in the contract, so a rule requiring
every item document in an item to agree on a number has, after the removal, no
item anywhere with two operands. Core's own admission test
([core v1 §1.2](../../specifications/core/v1/spec.md#admission), from
[ADR 0022](0022-the-musher-document-core-specification.md) §2) settles where it
goes: a rule belongs in core only when at least two families apply it, and after
this none does. Leaving it in place as dormant contract would cost a permanent
`UNPINNED` entry and a diagnostic code no document can provoke, which is the
arrangement §4 below is removing elsewhere in the same pass.

**What the rule was protecting is protected better.** Core §4.2 defended it by
saying that a listing whose revision has moved ahead of its blueprint "describes
something other than what would be installed". That was true, and the reason it
was true is that the item's release number had two copies. One copy cannot
diverge from itself.

**Blueprint states what the number counts.** `metadata.revision` on a blueprint
was defined only by the pin, plus the contrast component §4 draws against it.
With the pin gone, blueprint §3 says outright that the revision counts releases
of the catalog item, in the shape component §4 uses for a component's own
revision. Component §4's "the revision is not the item's revision" clause is
retargeted at blueprint §3 and remains true.

Earlier records keep their references to `CORE-ITEM-002`,
`ERR_VERSION_MISMATCH` and `LIST-ID-002` as history. An ADR is immutable, and
`conformance.ts` already scopes its prose-code check to the `spec.md` files for
exactly this reason: a code that no longer exists is correct in a record of when
it did.

### 2. The item classification is bound to the item, and is named `itemType`

`spec.listingKind` survives the removal, and two things change about it.

**It is renamed `spec.itemType`.**
[ADR 0007](0007-naming-conventions.md) §1 says `kind` "names a **document
family** and nothing else", and reserves `type` for "a tagged union or a
subcategory". `workload.kind` became `workload.type` on that rule;
`listingKind` was missed, and listing §2 has carried a "do not confuse `kind`
with `spec.listingKind`" warning ever since. A field needing a warning against
its own name is the rule reporting itself. `itemType` says what it classifies:
the catalog item, which is also what §3 below measures it against.

**It is bound to the item's contents.** Listing §3 recorded the gap plainly:
"A listing declaring `listingKind: BLUEPRINT` in an item holding no
`blueprint.yaml` is not detected." A required field that nothing reads and
nothing checks is a claim, and a claim a storefront renders is worse than no
field. The new rule binds both directions, `LIST-ITEM-001`:

> `spec.itemType` MUST be `BLUEPRINT` if and only if the item root holds
> `blueprint.yaml`.

`semantic`, reported as `ERR_ITEM_TYPE_MISMATCH`, measured against the item root
and silent where an implementation was handed a document rather than a directory
([core v1 §4.1](../../specifications/core/v1/spec.md#item-directory)).

`LIST-ID-*` is deliberately not reused for this ID.
[ADR 0022](0022-the-musher-document-core-specification.md) §3 folded
`LIST-ID-001` and `LIST-ID-002` into `CORE-ITEM-001` and `CORE-ITEM-002`, and
one identifier names one rule.

### 3. A URL field is spelled `URL`

[ADR 0007](0007-naming-conventions.md) §2 states the rule generally: acronyms
keep their conventional case, `IOPS`, `SKU`, `VRAM`, `URL`, `ID`, except where
the acronym begins a `camelCase` name. Its rename table listed no `…Url` field,
so `acceleratorSkuClass` became `acceleratorSKUClass` and four URL fields were
left behind.

`homepageUrl`, `sourceRepoUrl` and `supportUrl` become `homepageURL`,
`sourceRepoURL` and `supportURL`; component's `source.repositoryUrl` becomes
`source.repositoryURL`. This applies an accepted rule rather than deciding a new
one, and it is recorded here because the change is breaking and the window is
what makes it free.

The two remain separate names. Listing's `sourceRepoURL` is where a reader finds
the listed software's source; component's `repositoryURL` is what the platform
builds into an image. They answer different questions and are not unified.

### 4. `LIST-MEDIA-004` is withdrawn as an identifier

The rule stays, word for word. What goes is the number on it.

[docs/conformance.md](../conformance.md#requirements) is explicit: "An ID
names a rule a document can violate… Rules about what an *implementation* does
rather than what a document contains… are normative prose and carry no ID,
because an identifier whose permanent state is 'excused' documents nothing."
`LIST-MEDIA-004` obliges a consumer to resolve a description image through the
media mapping it already holds. No document can violate it, no fixture can watch
it, and it has sat in the conformance runner's `UNPINNED` map since it was
written.

Listing §4.1's renderer clause and §5.1's omit-never-remote clause are the same
class of rule, carry no identifier, and are cited by section. So is
[ADR 0018](0018-install-form-presentation.md) §1's derivation clause, whose
proposal for an identifier that ADR rejected on the grounds that "it would add a
second permanently-`UNPINNED` entry, turning a recorded anomaly into a pattern".
`LIST-MEDIA-004` is the anomaly that was measured against. Withdrawing it empties
the list of the only entry that was never going to leave.

### 5. Four listing fields are bounded while the window is open

Each is a gap listing §9 or §10 already records, and each costs a major version
to close once the window shuts.

**`license` gets a grammar.** Listing §9 and §10 call it "unbounded free text
that nothing checks", which the schema's `maxLength: 256` already contradicted.
[ADR 0003](0003-controlled-vocabulary-placement.md) decides the shape: §2 names
the surface that publishes the vocabulary, `https://spdx.org/licenses/`, and
forbids restating its members; §4 puts the *grammar* in the schema as a
`pattern`, so a typo fails offline rather than on a round trip. The pattern
accepts a flat SPDX licence expression, identifiers joined by `AND`, `OR` or
`WITH`, and is rejected with `ERR_INVALID_VALUE` in the `structural` phase.

ADR 0003 §3 would make *membership* a `capability` rule with a diagnostic in the
runner's `UNCOVERED` list. This pass declines it and records it as a gap in
listing §9. A grammar stops the typos; deciding that `MIT` is a real SPDX
identifier needs the network, and the contract does not yet need the answer.

A parenthesised expression is outside the grammar too, for a different reason: a
`pattern` cannot express nesting, and every other pattern in these bundles is
lookahead-free so that it compiles under RE2. Admitting one later relaxes the
field rather than narrowing it, which makes it a minor release whenever an
author needs it, so it is recorded in listing §9 rather than reached for now.

**`tags` and `screenshots` get bounds.** `tags` gains `maxItems` and
`uniqueItems`, and `screenshots` gains `maxItems`. Listing §4 argues at length
that the tag grammar is "what makes two spellings of one tag impossible rather
than merely discouraged", while the same array permitted one tag listed twice;
blueprint's `acceleratorRuntimes` and `cpuArchitectures` have carried
`uniqueItems` throughout. `screenshots` needs no `uniqueItems`, because
`LIST-MEDIA-003` already forbids two of them sharing a basename.

## Consequences

**Positive**

- A listing document carries identity and presentation, and nothing a deployment
  reads or a release counts. §1's claim that it "carries presentation only" is
  now true of its `metadata` as well as its `spec`.
- Listing §3 loses about thirty lines whose entire subject was a number, and
  core §4.2 loses two paragraphs plus a back-link into a family specification.
- The gap listing §3 recorded is closed rather than re-recorded, so the
  `itemType` a storefront renders is a fact about the item rather than a claim
  about it.
- The conformance runner's `UNPINNED` list holds only entries that are excused
  for a reason about fixtures, not about the rule.
- ADR 0007 is true of every field in the contract, not of the ones its rename
  table happened to list.

**Negative**

- A `COMPONENT` item has no item-level release number. Nothing counts releases
  of such an item as a whole, and a storefront wanting to show one reads the
  component revisions beneath it. This is accepted: the item's content is the
  component documents, and component §4 orders those.
- A listing handed over on its own, with no directory, can no longer be placed in
  a release lineage at all. It could not be validated against one either, since
  every item rule needs an item root, so what is lost is a number that was
  already unverifiable in that position.
- Four families take a breaking change at once, and every fixture carrying a
  listing document is edited. The window is what makes that affordable, and it
  will not be affordable again.

**Rejected**

- **Keeping `CORE-ITEM-002` dormant** for a future second item document. It
  would be a rule nothing can violate, needing a permanent `UNPINNED` entry and
  leaving `ERR_VERSION_MISMATCH` in a registry with no case, at the same time as
  §4 above removes exactly that arrangement. A later family that needs the rule
  can state it, and will know what it is for.
- **Making the listing's revision optional** rather than removing it. The
  divergence the rule prevented becomes possible again the moment the field is
  present, so the rule would have to stay, and the prose defending it with it.
  An optional field with a conditional rule is more contract than the required
  field it replaces.
- **Removing `itemType` entirely** and deriving the classification from whether
  the item holds a `blueprint.yaml`. The derivation needs the item directory,
  and core §4.1 is explicit that a consumer may be handed a document without
  one. A storefront filtering applications from building blocks would have
  nothing to filter on.
- **Unifying `sourceRepoURL` with component's `repositoryURL`.** One is for a
  reader and one is for a builder. A shared name would assert they are the same
  URL, which they need not be.
- **Making SPDX membership a `capability` rule** now, per ADR 0003 §3. It is the
  correct eventual placement and is recorded as a gap rather than done, because
  it adds a diagnostic code and an `UNCOVERED` entry for a check nothing is yet
  asking for.
