# Musher Listing Document — Specification v1

**Status:** Draft (pre-stable)
**Family:** `listing`
**Schema:** `https://specifications.musher.dev/listing/v1/listing.schema.json`

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when, and only when, they
appear in all capitals, as shown here.

> **What is normative.** This document, together with the
> [Musher Document Core Specification](../../core/v1/spec.md) it applies,
> defines the complete behaviour of the specification. The JSON Schema bundle is its executable form for structural
> validity, and the [conformance corpus](../../../docs/conformance.md) is its
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

A **Listing Document** is the catalog storefront entry for a blueprint or a
component: how it is presented, categorised, and discovered.

It carries presentation only. It MUST NOT influence how the workload runs — a
listing is never an input to deployment.

## <a id="envelope"></a>2. Document envelope

```yaml
specVersion: v1
kind: LISTING
metadata: { slug: … }
spec: { itemType: …, displayName: …, … }
```

A Listing Document is a Musher document as the
[Musher Document Core Specification](../../core/v1/spec.md) defines one, and
every rule of core v1 applies to it. This family binds the parameters
[core v1 §1.1](../../core/v1/spec.md#bindings) leaves to a family:

| Core parameter | This family |
|---|---|
| `kind` ([`CORE-ENV-002`](../../core/v1/spec.md#CORE-ENV-002)) | `LISTING` |
| `metadata` ([`CORE-ENV-003`](../../core/v1/spec.md#CORE-ENV-003)) | [§3](#identity) |
| Fields accepting `null` ([`CORE-ENV-007`](../../core/v1/spec.md#CORE-ENV-007)) | None |
| Item document ([core v1 §4.1](../../core/v1/spec.md#item-directory)) | `listing.yaml` |

This specification narrows core v1 where it says so and relaxes it nowhere. It
cites core by its line — "core v1 §N" — and the core edition a release was
built and tested against is recorded with that release
([core v1 §9](../../core/v1/spec.md#editions)).

**Normative dependencies**

| Specification | Line |
|---|---|
| [core](../../core/v1/spec.md) | v1 |

## <a id="identity"></a>3. Identity

`metadata` carries `slug` and nothing else. It is bound by the rule stated once
for every family in [core v1 §4.2](../../core/v1/spec.md#item-identity):
[`CORE-ITEM-001`](../../core/v1/spec.md#CORE-ITEM-001) binds it to the item
directory name, measured against the item root [§3.1](#item-directory) locates.

**A listing carries no revision, and the absence is the contract.** A listing
presents an item; it does not release one. What counts releases of a catalog
item is the blueprint's `metadata.revision`
([blueprint §3](../../blueprint/v1/spec.md#identity)), and an item holding no
blueprint is released by the component documents beneath it, each of which
counts its own ([component §4](../../component/v1/spec.md#metadata)). A copy of
either number on this document could only agree with the original or be wrong,
and a reader who found the two disagreeing would have no way to tell which one
described what would be installed.
[ADR 0025](../../../docs/adr/0025-the-listing-carries-no-revision.md) records
the withdrawal, and the rule that policed the copy with it.

`spec.itemType` says which of those two shapes the item has, and the item
decides:

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="LIST-ITEM-001"></a>`LIST-ITEM-001` | `spec.itemType` MUST be `BLUEPRINT` if and only if the item root holds `blueprint.yaml`. | `ERR_ITEM_TYPE_MISMATCH` |

`semantic`, because it reads the item root rather than the document, and
reported at `/spec/itemType`.

**A classification a storefront renders should be a fact rather than a claim.**
`itemType` decides which shelf an item appears on, and it is the one field here
that something outside the document can settle. Left to the author it is an
assertion about a directory they may not have looked at: an item whose
`blueprint.yaml` was removed goes on advertising a composition nobody can
install, and an item that gained one goes on presenting itself as a single
building block. Without the rule above, both validate.

Do not confuse `kind` with `spec.itemType`. `kind` identifies the document
format, and [ADR 0007](../../../docs/adr/0007-naming-conventions.md) §1 reserves
the word for that; `itemType` identifies the shape of the item this document
presents.

### <a id="item-directory"></a>3.1 The item directory

`listing.yaml` is this family's item document, so the directory containing it is
the item root [core v1 §4.1](../../core/v1/spec.md#item-directory) defines. An
item whose `itemType` is `COMPONENT` holds no `blueprint.yaml`, and it has a
root all the same: `metadata.slug` is measured against it,
[`LIST-ITEM-001`](#LIST-ITEM-001) looks inside it, and [§5](#media) resolves
every media path within it.

```
<slug>/
  listing.yaml          this document
  components/           the component documents the item publishes
  media/                icon and screenshots
```

Where the item holds a blueprint as well, the two are siblings under that one
root.

Two names in that tree are fixed: `listing.yaml`, and `media/` by
[§5](#media). Component documents MAY sit anywhere under the root —
`components/` is the same convention
[blueprint §3.1](../../blueprint/v1/spec.md#item-directory) describes, and a flat
sibling is equally valid.

**An item MAY hold more than one component document.**
[Blueprint §3](../../blueprint/v1/spec.md#identity)'s
`ERR_UNREFERENCED_COMPONENT` has no analogue in this shape. That rule exists
because a blueprint's graph names the documents it deploys, so a document the
graph does not name is invisible; there is no graph here to name anything.

The no-directory rule of [core v1 §4.1](../../core/v1/spec.md#item-directory)
reaches §5 as well as §3. A listing handed over without
a directory has no item root, so an implementation in that position MUST NOT
report `ERR_ITEM_TYPE_MISMATCH`, `ERR_MEDIA_NOT_FOUND` or `ERR_PATH_ESCAPE`
either — each of them reads a root it has not been given.

## <a id="presentation"></a>4. Presentation

`displayName` is the item's title on the storefront. It is REQUIRED and at most
200 characters. It is the name a reader sees before anything else on the page,
and it is the item's own: a listing that repeats its category or its summary
here has given the storefront nothing to label the entry with.

`summary` is plain text, at most 280 characters, and MUST NOT be rendered as
Markdown. It is a one-line tagline; rendering it as Markdown turns an
underscore in a product name into emphasis and an asterisk into a bullet. This
is the first of three rules here that bind what a consumer emits rather than
what an author writes; [§4.1](#description-markdown) states the second and
[§5.1](#media-resolution) the third.

`description` is Markdown, at most 20 000 characters, and is constrained to the
profile in [§4.1](#description-markdown).

`homepageURL`, `sourceRepoURL`, and `supportURL` each carry one absolute URL. A
value MUST use the `https`, `http`, or `mailto` scheme, in any case, MUST carry
no whitespace, and is at most 2048 characters; one that does not is rejected in
the `structural` phase with `ERR_INVALID_VALUE`. The scheme set is
[§4.1](#description-markdown)'s, because `javascript:` in `homepageURL` is the
same stored injection as `javascript:` in a description link and a storefront
renders both. The rest of that rule is not shared: a description link may also
be a fragment beginning `#`, and a fragment is not a destination one of these
fields can have.

**The scheme is compared case-insensitively, and this is stated because the
schema cannot state it.** [RFC 3986 §3.1](https://datatracker.ietf.org/doc/html/rfc3986#section-3.1)
makes a scheme case-insensitive while naming lowercase as the canonical form, so
`HTTPS://example.com` is legal-but-non-canonical input rather than a different
URL. The two placements of this rule must agree on it: a consumer that finds a
link destination parses it, and parsing normalises the scheme, whereas a JSON
Schema `pattern` carries no case-insensitive flag and must spell the alternation
out in character classes to reach the same answer. [§5](#media) spells its
extension alternation the same way for the same reason. An implementation MAY
canonicalise a scheme to lowercase before storing it; it MUST NOT reject a
document for the case of a permitted one.

`category` and `lifecycleStage` are controlled vocabularies, described in
[§4.2](#vocabularies).

**A tag is lowercase kebab-case.** Each member of `tags` MUST match
`^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$`, and one that does not is rejected in the
`structural` phase with `ERR_INVALID_VALUE`. A tag is a discovery key that a
storefront groups listings by, so `Self-Hosted`, `self hosted` and
`self-hosted` being three tags rather than one is a defect the grammar prevents
instead of a normalisation every consumer has to reinvent. The vocabulary
itself stays open — what a tag *says* is the author's, and only how it is
spelled is this contract's.

**The tags are a set, and a short one.** A member MUST NOT repeat, and there are
at most sixteen. The grammar above exists to stop one tag being spelled two
ways; permitting it twice in one list would leave the same defect one step
along. The bound is what keeps a discovery key a discovery key: a list long
enough to hold every word in the description is a list a storefront cannot group
on.

`license` names the licence of the listed software. It MUST be an SPDX licence
expression, and one that is not is rejected in the `structural` phase with
`ERR_INVALID_VALUE`. The identifiers are published at
<https://spdx.org/licenses/> and are deliberately not restated here, for the
reason [ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) §2
gives. What this contract fixes is the shape: an identifier, optionally joined
to others by `AND`, `OR`, or `WITH`. Whether the identifier is one SPDX
publishes is not decided here ([§9](#known-debt)), and neither is a parenthesised
expression, which this grammar does not spell.

A `license` is still the author's claim rather than a verified fact, and
[§10](#security) says what a storefront may do with it.

Featured-row placement is **not** part of this contract. A listing document
MUST NOT declare `spec.featured`; promotion is a storefront-operator action,
not an authoring one. A document that declares it is rejected in the
`structural` phase with `ERR_UNKNOWN_FIELD`, like any other unknown property —
accepting it silently would let an author believe they had promoted their own
listing.

### <a id="description-markdown"></a>4.1 The description Markdown profile

`description` is **[CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/)**,
narrowed by the three rules below. Naming a grammar and a version is deliberate:
"Markdown" is not one language, and a rule written against it is a rule each
implementation resolves against whatever parser it happened to have.

A listing is authored by a third party and rendered by the storefront, so
`description` is untrusted content displayed in a first-party origin. These are
the rules that make it safe to render. The reasoning is recorded in
[ADR 0004](../../../docs/adr/0004-listing-description-trust-boundary.md).

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="LIST-MD-001"></a>`LIST-MD-001` | A description MUST NOT contain raw HTML — an *HTML block* ([CommonMark §4.6](https://spec.commonmark.org/0.31.2/#html-blocks)) or *raw HTML* inline ([§6.6](https://spec.commonmark.org/0.31.2/#raw-html)). | `ERR_RAW_HTML` |
| <a id="LIST-MD-002"></a>`LIST-MD-002` | A link destination MUST use the `https`, `http`, or `mailto` scheme, in any case (the comparison is [§4](#presentation)'s), or be a fragment beginning `#`. | `ERR_DISALLOWED_SCHEME` |
| <a id="LIST-MD-003"></a>`LIST-MD-003` | An image destination MUST be a media path as defined by [§5](#media). | `ERR_IMAGE_NOT_LOCAL` |

All three are `semantic`. Finding a link destination means parsing the document,
which no JSON Schema pattern can do — this is the same line
[§5](#media) draws between the media grammar it carries as a `pattern` and the
three rules it cannot.

**A code fence is not raw HTML.** CommonMark tokenises a code span and a fenced
code block as their own constructs, so a listing MAY document `<script>` or an
embed snippet inside one and remain conforming. This is the reason the rule is
written in CommonMark's terms rather than as a search for angle brackets: a
lexical rule would reject the authors writing honest documentation, which is
most of them. Character entity references — `&amp;`, `&#39;` — are likewise not
raw HTML.

**The rule reaches the renderer.** A consumer rendering `description` MUST NOT
emit an HTML element, an attribute, or a URL that this profile forbids, whether
or not it validated the document first. It is stated because an authoring rule
alone would protect nobody: the document this profile exists to stop is written
by someone who will not run the validator.

This is the second of the three rules here that constrain an implementation's
output rather than a document, after [§4](#presentation)'s on `summary` and
before [§5.1](#media-resolution)'s on a description image. All three are here
because what a consumer does with a listing is not settled by a rule about what
an author may write, and a rule each consumer resolves privately is not a
contract.

**An image is a media path, with everything that follows from it.** [§5](#media)
fixes `media/` as the one directory an item ships assets from, and a description
image is held to the same grammar — so a remote image is not merely discouraged,
it is unspellable. It is a rule rather than a note because a remote image
discloses every storefront viewer's IP address and user agent to a host the
listing author chose, on every page view, with no interaction. §5's `semantic`
rules reach a description image too: it MUST resolve to a file that exists and
MUST lie inside the item root, reported at `/spec/description` with
`ERR_MEDIA_NOT_FOUND` and `ERR_PATH_ESCAPE`. Basename uniqueness does not — that
rule is about the screenshot gallery, which a description image is not part of.
What the destination resolves to for a consumer that does not serve the item
directory itself is [§5.1](#media-resolution).

**What v1 does not constrain.** A link target is never fetched, so nothing here
decides whether a permitted scheme points somewhere hostile; that is a
moderation problem and not a validation one. Nor is there a bound on how many
links, images, or headings a description may hold.

### <a id="vocabularies"></a>4.2 Category and lifecycle stage

`category` and `lifecycleStage` are **fixed by this contract**: the schema
carries each as a closed `enum`, and a value outside it is rejected in the
`structural` phase with `ERR_INVALID_VALUE`. That is
[ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) §1's
placement one, and it is the right one for the reason that ADR gives — the test
is who decides membership, and a storefront category becomes real when this
repository releases, not when an operator provisions something.

This is where the two fields stop resembling each other.

**`category` is an open taxonomy.** It is the field most likely to need
extension, and it is the one where the path of least resistance always points
the same way: a publisher whose item fits nothing reaches for a new term, and no
individual term is the one that does the damage. Adding a term is a minor
release and removing one is a new major, so growth is cheap in every single case
and irreversible in aggregate. The rule that governs it is editorial and lives
in [docs/governance.md](../../../docs/governance.md) → *Changing a controlled vocabulary*,
because it is a process rule and that is where process rules live.

**`lifecycleStage` is a closed progression**, and does not share that rule.
`EXPERIMENTAL`, `BETA`, and `STABLE` are ordered — each claims more about the
item than the one before — and `SUNSET` is terminal rather than a fourth point
on the scale: it says the item is going away, which is a statement about the
future and not about maturity reached. The ordering is stated because the
storefront sorts and filters on it, and a consumer that had to infer it from the
names would be inventing contract.

A new stage therefore changes what the storefront *means* rather than how it
sorts, and docs/governance.md gates one on an accepted ADR instead of the category
admission test.

**Neither field's terms are restated here.** The schema is where they live, and
a second copy in prose is a copy that can disagree — the same reasoning ADR 0003
§2 applies to a vocabulary published elsewhere, applied to one published here.

## <a id="media"></a>5. Media

`icon` and `screenshots[].file` are media paths, resolved inside the item root
[core v1 §4.1](../../core/v1/spec.md#item-directory) defines.

`screenshots` is the storefront gallery, in display order, and holds at most
twelve entries. The bound is on the gallery a person scrolls rather than on the
bytes an item ships: past a dozen, a reader has stopped looking and the entries
after that are cost with no reader. Each entry MAY carry a `caption`, plain text
of at most 280 characters, which is the accessible description of the image and
is shown beneath it.

A media path MUST satisfy all of the following, and is rejected in the
`structural` phase with `ERR_INVALID_VALUE` when it does not:

- it MUST be relative — a leading `/` is not accepted;
- its first segment MUST be exactly `media`;
- every segment after that MUST begin with a letter or a digit, which is how
  `.` and `..` are excluded as segments without a negative lookahead;
- every later character of a segment MUST be a letter, a digit, `.`, `_`, or
  `-`, which is how a space, a backslash and a control character are excluded;
- it MUST end in `.png`, `.jpg`, `.jpeg`, or `.webp`, in any case;
- it is at most 512 characters.

**`media/` is a stronger rule than "relative to the listing document".** One
fixed directory means a reader can find every asset an item ships without first
reading its listing, and a publisher can copy that directory without walking the
document to work out what to take. A path merely relative to the document buys
neither, and the two are easy to confuse because every conforming path satisfies
both.

Three rules need the filesystem and are therefore `semantic`:

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="LIST-MEDIA-001"></a>`LIST-MEDIA-001` | The path MUST resolve to a file that exists. | `ERR_MEDIA_NOT_FOUND` |
| <a id="LIST-MEDIA-002"></a>`LIST-MEDIA-002` | The resolved target MUST lie inside the item root. | `ERR_PATH_ESCAPE` |
| <a id="LIST-MEDIA-003"></a>`LIST-MEDIA-003` | Two screenshots MUST NOT share a basename. | `ERR_DUPLICATE_MEDIA_BASENAME` |

**`ERR_PATH_ESCAPE` outlives the grammar.** The pattern above makes `..`
unspellable, so no path can escape by traversal any more. One can still escape
by symlink — `media/icon.png` pointing outside the item is a legal spelling
resolving to an illegal target. Containment is a property of the resolved
location rather than of the string, the same distinction
[core v1 §11](../../core/v1/spec.md#security) draws for every path inside an
item.

**Basenames must differ across the whole item**, not merely within a
directory: `media/desktop/overview.png` and `media/mobile/overview.png`
collide. A gallery addresses its entries by basename, so two screenshots called
`overview.png` are one entry. The constraint is a real one on an author and is
stated here rather than left to be found out when the second screenshot
silently replaces the first. It stops at the gallery because
[§5.1](#media-resolution) keys the published media set on the whole path rather
than on the basename.

**What v1 does not constrain.** Neither dimensions nor file size are bounded.
A storefront cannot reserve space for an image whose aspect ratio it does not
know, so this is a gap rather than a permission — but bounding either one
rejects listings that validate today, which makes closing it a breaking
change.

### <a id="media-resolution"></a>5.1 Resolution after ingest

A media path is authoring-time input. It is written against the item root, and
the item root is a directory in the publisher's repository — a consumer that
ingests an item and serves it from somewhere else does not have one.

`icon` and `screenshots[].file` survive that move because they are fields. A
consumer reads them, takes the bytes, and rewrites each field to whatever it
serves them from; it knows exactly which properties hold a media path. A
description image survives nothing, because it is inside a Markdown blob:
nothing enumerates it, so nothing rewrites it, and `media/overview.png` resolves
against a directory that is no longer there.

**The published media set is that mapping, named.** A consumer serving an item
from anywhere other than the item directory holds, for each media path the item
ships, the location it serves those bytes from. A consumer that rewrites `icon`
already has this mapping — it is what the rewrite is — and this section does no
more than say a description image is entitled to it.

**A consumer that rewrites `icon` or `screenshots[].file` to a location it
serves MUST resolve a `description` image destination through the same
mapping.** The obligation carries no requirement ID: no document can violate it,
so an identifier on it would name a rule the corpus could never pin, which is
what [docs/conformance.md](../../../docs/conformance.md#requirements) reserves
prose for. It is cited by section, as the two output rules beside it are.

**The mapping is keyed on the media path**, whole and unmodified — not on the
basename, and not on the location the bytes end up at. This is why
`LIST-MEDIA-003` stops at the screenshot gallery rather than reaching every
media path, and why [§4.1](#description-markdown) can exempt a description image
from it: `media/desktop/overview.png` and `media/mobile/overview.png` are two
keys, and a consumer that shortened them to one would have made the collision it
was avoiding.

**The mapping always has an entry.** [§4.1](#description-markdown) already holds
a description image to `LIST-MEDIA-001`, so an item referencing an image it does
not ship is rejected before a consumer sees it. The obligation above is never
asked to resolve something the item did not publish, and a consumer holding a
description image it has no entry for is holding a document that did not
validate.

**An image that will not resolve is omitted, never made remote.** A consumer
that cannot resolve a description image MUST NOT emit a remote URL in its place.
It MAY omit the `img` element and render the alt text instead, and that is the
behaviour this section expects of it. The failure mode being forbidden is the
helpful one: a storefront repairing a broken image by pointing it somewhere
reachable has reopened the beacon [§4.1](#description-markdown) closed, on a
page the author no longer controls.

**This binds an implementation's output, which is the third such rule here.**
[§4.1](#description-markdown) counts them, and the grounds are the same in each
case. Left unsaid, the resolution is invented once per consumer and in private.
That is the objection
[ADR 0004](../../../docs/adr/0004-listing-description-trust-boundary.md) opens
with, reaching one step further downstream than it did.

**No fixture pins this section.** The corpus validates documents, and nothing in
it can observe what a storefront emits — the limit ADR 0004 already records for
the renderer clause. It is a rule this specification states and cannot test, and
saying so is better than a fixture that appears to cover it.

## <a id="validation-layers"></a>6. Validation layers

As defined in [core v1 §6](../../core/v1/spec.md#validation-layers), and
written in the YAML profile
[core v1 §6.1](../../core/v1/spec.md#yaml-profile) states.

## <a id="diagnostics"></a>7. Diagnostics

The codes in [core v1 §7](../../core/v1/spec.md#diagnostics) apply to every
document in this family. This family adds:

| Code | Phase | Meaning |
|---|---|---|
| `ERR_ITEM_TYPE_MISMATCH` | `semantic` | `spec.itemType` disagrees with what the item root holds. |
| `ERR_MEDIA_NOT_FOUND` | `semantic` | A referenced media file does not exist. |
| `ERR_PATH_ESCAPE` | `semantic` | A media path resolves outside the item directory. |
| `ERR_DUPLICATE_MEDIA_BASENAME` | `semantic` | Two screenshots share a basename. |
| `ERR_RAW_HTML` | `semantic` | `description` contains raw HTML. |
| `ERR_DISALLOWED_SCHEME` | `semantic` | A `description` link uses a scheme outside the permitted set. |
| `ERR_IMAGE_NOT_LOCAL` | `semantic` | A `description` image is not an item media path. |

## <a id="conformance"></a>8. Conformance

An implementation conforms to this specification when it produces the declared
outcome for every case in [this family's corpus](conformance/) and in the
[core corpus](../../core/v1/conformance/) at the core edition the release
records ([core v1 §8](../../core/v1/spec.md#conformance)). It MUST declare the
profile it claims, as [core v1 §8](../../core/v1/spec.md#conformance) requires. A
skipped case is never a passed one.

## <a id="known-debt"></a>9. Known debt

Each entry below is a gap this version leaves open, with the section that
records it. Unless an entry says otherwise, closing one rejects a document v1
accepts, which makes it a new major once this family is released.

**Media is unbounded in dimensions and file size** ([§5](#media)). A storefront
cannot reserve space for an image whose aspect ratio it does not know, and
nothing here tells it one.

**An SPDX identifier is checked for its shape and not its membership**
([§4](#presentation)). `license: MTI` is a well-formed expression naming a
licence nobody publishes, and this version accepts it. Deciding membership needs
the surface that publishes the vocabulary, which makes it a `capability` rule
under [ADR 0003](../../../docs/adr/0003-controlled-vocabulary-placement.md) §3
rather than one an offline validator may report.

A parenthesised expression, which SPDX permits and [§4](#presentation)'s grammar
does not spell, is open for a different reason: a `pattern` cannot express
nesting. It is the exception this section opens by allowing for: admitting a
parenthesised expression accepts documents this version rejects rather than the
other way about, so it is a minor release whenever an author needs it.

**A `tags` member is checked for its spelling and not its content**
([§4](#presentation)). The grammar fixes how a tag is written; what it says is
the author's.

One debt is of a different kind, and is not closed by rejecting anything.
[§5.1](#media-resolution) obliges a consumer to resolve a description image
through the mapping it already holds, and no fixture can watch it do so: the
corpus validates documents and cannot observe what a storefront emits. It is the
third clause here in that position, after [§4](#presentation)'s on `summary` and
[§4.1](#description-markdown)'s renderer clause, and like them it carries no
requirement ID. Saying so here is better than a fixture that appears to cover
it.

## <a id="security"></a>10. Security considerations

[Core v1 §11](../../core/v1/spec.md#security) applies in full: a listing
document is untrusted input. This section adds what is specific to listing:
alone among the three families, its content is **rendered to other people**.

**The description is a stored-injection surface.** [§4.1](#description-markdown)
is the trust boundary, and [ADR 0004](../../../docs/adr/0004-listing-description-trust-boundary.md)
records why it is drawn where it is. Two things about it are security rules
rather than formatting ones:

The renderer obligation in [§4.1](#description-markdown) — that a consumer MUST
NOT emit an element, attribute, or URL the profile forbids, *whether or not it
validated the document first* — is one of the three rules here that constrain an
implementation's output rather than a document, and it is the one with teeth. It
is stated that way deliberately.
Validation happens where a document is submitted; rendering happens wherever the
storefront runs, possibly against a document stored before a rule existed. A
renderer that trusts validation to have happened is a renderer that will emit
whatever is in the database.

The URL scheme rule covers `homepageURL`, `sourceRepoURL`, and `supportURL` as
well as links inside Markdown ([§4](#presentation)). `javascript:` in a
storefront field is the same stored injection as `javascript:` in a description
link, and a renderer treats both as a link.

**Remote images disclose viewers.** [§5](#media) requires media to be a path
inside the item rather than a URL. A remote image would make every storefront
visitor's IP address and user agent visible to a host the listing's author chose,
turning a catalog page into a tracking beacon on behalf of a third party.

That rule survives ingest or it was never a rule. [§5.1](#media-resolution)
forbids a consumer from substituting a remote URL for a description image it
cannot resolve, and the clause is here as well as there because the substitution
is the *repair* — a storefront doing it is fixing a broken image, not attacking
anyone, and it reopens the beacon exactly as an author-supplied remote image
would. A consumer that cannot resolve one omits it.

**Media paths are paths.** `ERR_PATH_ESCAPE` is the listing's form of the
containment rule; the symlink and resolved-location requirements
[core v1 §11](../../core/v1/spec.md#security) sets for every path inside an item
apply to it. An
implementation MUST NOT decode or transcode a media file to validate it —
[§5](#media) turns on existence and containment, and nothing here requires an
image parser to be pointed at untrusted bytes.

**A checked shape is not a checked fact.** `license` is held to the SPDX
expression grammar and a `tags` member to the kebab-case one, and neither rule
looks at what the value says ([§9](#known-debt)). A storefront MUST escape both
on render and MUST NOT treat `license` as an assertion about licensing — a
well-formed expression naming a real licence is still an author's claim about
software this repository has never seen.
