# Musher Listing Document — Specification v1

**Status:** Draft (pre-stable)
**Family:** `listing`
**Schema:** `https://schemas.musher.dev/listing/v1/listing.schema.json`

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when, and only when, they
appear in all capitals, as shown here.

> **What is normative.** This document defines the complete behaviour of the
> specification. The JSON Schema bundle is its executable form for structural
> validity, and the [conformance corpus](../../../conformance/README.md) is its
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
metadata: { slug: …, version: … }
spec: { listingKind: …, displayName: …, … }
```

`kind` MUST be `LISTING`. All envelope rules in
[component §2](../../component/v1/spec.md#envelope), and the version
compatibility rules in
[component §3](../../component/v1/spec.md#compatibility), apply identically.

Do not confuse `kind` with `spec.listingKind`. `kind` identifies the document
format; `listingKind` identifies what the listing points at (`BLUEPRINT` or
`COMPONENT`).

## <a id="identity"></a>3. Identity

`metadata` carries `slug` and `version` — the same shape a blueprint carries.
Where the item holds one, the two documents MUST agree.

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="LIST-ID-001"></a>`LIST-ID-001` | `metadata.slug` MUST equal the item directory name. | `ERR_SLUG_MISMATCH` |
| <a id="LIST-ID-002"></a>`LIST-ID-002` | Where the item holds a blueprint, `metadata.version` MUST equal its `metadata.version`. | `ERR_VERSION_MISMATCH` |

Both are `semantic`, and both are measured against the item root —
[blueprint §3.1](../../blueprint/v1/spec.md#item-directory) where the item
holds a blueprint, [§3.1](#component-item) below where it does not. A listing
handed over with no directory has no item root, and an implementation in that
position MUST NOT report either rule.

**The two documents are one item's two halves.** A listing whose version has
moved ahead of its blueprint describes something other than what would be
installed — this release's storefront copy over last release's graph. The rule
is what keeps "read about this" and "install this" the same thing.

**A `COMPONENT` item's listing version is bound to nothing, and that is a rule
rather than the absence of one.** The rule above pins an item's two halves to
each other, so it takes two. An item whose listing is
`listingKind: COMPONENT` need not hold a blueprint, and where it holds none the
rule has no second operand — not a different one.

The component documents beneath it are not that second operand.
[Component §4](../../component/v1/spec.md#metadata) settles this for the
blueprint shape already: an item's version counts releases of the item, a
component's counts releases of the component, and in the published form one
component is deployed by many items at once. The SHOULD stated there — that a
release of a component an item deploys is accompanied by a release of the item
— reaches a `COMPONENT` item unchanged, and carries no diagnostic here for the
reason it carries none there.

**Why not a designated primary.** An item MAY hold more than one component
document ([§3.1](#component-item)), so no single one of them is *the*
component. Pinning to a designated one would need a field naming which, which
is contract surface added to reproduce what the blueprint shape gets from its
graph — and it would contradict component §4, which says no item is pinned to a
component beneath it.

**What v1 does not constrain.** A listing declaring `listingKind: BLUEPRINT` in
an item holding no `blueprint.yaml` is not detected. The version rule is
conditioned on there being a sibling, so it goes silent rather than failing,
and `listingKind` is presentation ([§1](#scope)) — nothing reads it to decide
which files an item must hold. Closing this needs a rule that rejects items
validating today, which makes it a breaking change.

### <a id="component-item"></a>3.1 The COMPONENT item

[Blueprint §3.1](../../blueprint/v1/spec.md#item-directory) anchors the item
root on `blueprint.yaml`. An item whose listing is `listingKind: COMPONENT` has
no such file, and the version rule is not the only one that needs a root:
`metadata.slug` above is measured against one, and [§5](#media) resolves every
media path inside one.

```
<slug>/
  listing.yaml          this document
  components/           the component documents the item publishes
  media/                icon and screenshots
```

**The directory containing `listing.yaml` is the item root.** The two
definitions agree wherever both apply: an item holding a blueprint holds the
two documents as siblings, so the directory containing one is the directory
containing the other.

Two names in that tree are fixed: `listing.yaml`, and `media/` by
[§5](#media). Component documents MAY sit anywhere under the root —
`components/` is the same convention blueprint §3.1 describes, and a flat
sibling is equally valid.

**An item MAY hold more than one component document.** Blueprint §3's
`ERR_UNREFERENCED_COMPONENT` has no analogue in this shape. That rule exists
because a blueprint's graph names the documents it deploys, so a document the
graph does not name is invisible; there is no graph here to name anything.

The no-directory rule reaches §5 as well as §3. A listing handed over without
a directory has no item root, so an implementation in that position MUST NOT
report `ERR_MEDIA_NOT_FOUND` or `ERR_PATH_ESCAPE` either — both resolve a path
inside a root it has not been given.

## <a id="presentation"></a>4. Presentation

`summary` is plain text, at most 280 characters, and MUST NOT be rendered as
Markdown. It is a one-line tagline; rendering it as Markdown turns an
underscore in a product name into emphasis and an asterisk into a bullet.

`description` is Markdown, at most 20 000 characters, and is constrained to the
profile in [§4.1](#description-markdown).

`homepageUrl`, `sourceRepoUrl`, and `supportUrl` MUST use the `https`, `http`,
or `mailto` scheme, in any case. A value that does not is rejected in the
`structural` phase with `ERR_INVALID_VALUE`. The rule is
[§4.1](#description-markdown)'s, applied to the fields that carry a URL directly
rather than inside Markdown — `javascript:` in `homepageUrl` is the same stored
injection as `javascript:` in a description link, and a storefront renders both.

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
| <a id="LIST-MD-002"></a>`LIST-MD-002` | A link destination MUST use the `https`, `http`, or `mailto` scheme, in any case ([§4](#presentation)), or be a fragment beginning `#`. | `ERR_DISALLOWED_SCHEME` |
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
or not it validated the document first. This is the only rule in this
specification that constrains an implementation's output rather than a document,
and it is stated because an authoring rule alone would protect nobody: the
document this profile exists to stop is written by someone who will not run the
validator.

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
in [GOVERNANCE.md](../../../GOVERNANCE.md) → *Changing a controlled vocabulary*,
because it is a process rule and that is where process rules live.

**`lifecycleStage` is a closed progression**, and does not share that rule.
`EXPERIMENTAL`, `BETA`, and `STABLE` are ordered — each claims more about the
item than the one before — and `SUNSET` is terminal rather than a fourth point
on the scale: it says the item is going away, which is a statement about the
future and not about maturity reached. The ordering is stated because the
storefront sorts and filters on it, and a consumer that had to infer it from the
names would be inventing contract.

A new stage therefore changes what the storefront *means* rather than how it
sorts, and GOVERNANCE.md gates one on an accepted ADR instead of the category
admission test.

**Neither field's terms are restated here.** The schema is where they live, and
a second copy in prose is a copy that can disagree — the same reasoning ADR 0003
§2 applies to a vocabulary published elsewhere, applied to one published here.

## <a id="media"></a>5. Media

`icon` and `screenshots[].file` are media paths, resolved inside the item root
— [blueprint §3.1](../../blueprint/v1/spec.md#item-directory) where the item
holds a blueprint, [§3.1](#component-item) where it does not.

A media path MUST satisfy all of the following, and is rejected in the
`structural` phase with `ERR_INVALID_VALUE` when it does not:

- it MUST be relative — a leading `/` is not accepted;
- its first segment MUST be exactly `media`;
- every segment after that MUST begin with a letter or a digit, which is how
  `.` and `..` are excluded as segments without a negative lookahead;
- it MUST end in `.png`, `.jpg`, `.jpeg`, or `.webp`, in any case.

**`media/` is a stronger rule than "relative to the listing document".** That
was this section's earlier wording, and it is not what anything enforces. One
fixed directory means a reader can find every asset an item ships without
first reading its listing, and a publisher can copy that directory without
walking the document to work out what to take.

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
[blueprint §4.1](../../blueprint/v1/spec.md#component-reference) draws for a
component reference.

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

| ID | Rule | Diagnostic |
|---|---|---|
| <a id="LIST-MEDIA-004"></a>`LIST-MEDIA-004` | A consumer that rewrites `icon` or `screenshots[].file` to a location it serves MUST resolve a `description` image destination through the same mapping. | — |

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

**This binds an implementation's output, which is the second such rule here.**
[§4.1](#description-markdown)'s renderer clause is the first, and the grounds
are the same — what a consumer does with a description is not settled by a rule
about what an author may write. Left unsaid, the resolution is invented once per
consumer and in private, and a rule each consumer resolves differently is not a
contract. That is the objection
[ADR 0004](../../../docs/adr/0004-listing-description-trust-boundary.md) opens
with, reaching one step further downstream than it did.

**No fixture pins this section.** The corpus validates documents, and nothing in
it can observe what a storefront emits — the limit ADR 0004 already records for
the renderer clause. `LIST-MEDIA-004` is carried in the conformance runner's
`UNPINNED` list with that reason. It is a rule this specification states and
cannot test, and saying so is better than a fixture that appears to cover it.

## <a id="validation-layers"></a>6. Validation layers

As defined in [component §7](../../component/v1/spec.md#validation-layers), and
written in the YAML profile
[component §7.1](../../component/v1/spec.md#yaml-profile) states.

## <a id="diagnostics"></a>7. Diagnostics

The codes in [component §8](../../component/v1/spec.md#diagnostics) apply. This
family adds:

| Code | Phase | Meaning |
|---|---|---|
| `ERR_SLUG_MISMATCH` | `semantic` | `metadata.slug` disagrees with the item directory name. |
| `ERR_VERSION_MISMATCH` | `semantic` | `metadata.version` disagrees with the sibling blueprint document. |
| `ERR_MEDIA_NOT_FOUND` | `semantic` | A referenced media file does not exist. |
| `ERR_PATH_ESCAPE` | `semantic` | A media path resolves outside the item directory. |
| `ERR_DUPLICATE_MEDIA_BASENAME` | `semantic` | Two screenshots share a basename. |
| `ERR_RAW_HTML` | `semantic` | `description` contains raw HTML. |
| `ERR_DISALLOWED_SCHEME` | `semantic` | A `description` link uses a scheme outside the permitted set. |
| `ERR_IMAGE_NOT_LOCAL` | `semantic` | A `description` image is not an item media path. |

## <a id="conformance"></a>8. Conformance

An implementation conforms when it produces the declared outcome for every
fixture in [`conformance/listing/v1/`](../../../conformance/listing/v1/).

An implementation MUST declare the **profile** it claims, as
[component §9](../../component/v1/spec.md#conformance) requires and
[conformance/README.md](../../../conformance/README.md#profiles) defines. A
skipped case is never a passed one.


## <a id="known-debt"></a>9. Known debt

Seeded from the platform's generated schema. The naming that arrived with it
has been cleaned, and the seed-authoring-only `featured` block has been removed
from the contract (§4).

No section of this document is marked TODO any longer. The last two were both in
§4, and both were security or governance questions rather than undocumented
behaviour: the permitted Markdown subset for `description`, now
[§4.1](#description-markdown) and
[ADR 0004](../../../docs/adr/0004-listing-description-trust-boundary.md); and
the rule for admitting a `category` or `lifecycleStage` term, now
[§4.2](#vocabularies) and GOVERNANCE.md.

What remains is a gap rather than a silence, and each is recorded where it
applies: media dimensions and file size are unbounded ([§5](#media)), a
`listingKind: BLUEPRINT` listing in an item holding no blueprint goes undetected
([§3](#identity)), and `tags` and `license` are unbounded free text that nothing
checks. Closing any of them rejects documents v1 accepts. See
[component §10](../../component/v1/spec.md#known-debt).

One debt is of a different kind, and is not closed by rejecting anything.
[§5.1](#media-resolution) obliges a consumer to resolve a description image
through the mapping it already holds, and no fixture can watch it do so — the
corpus validates documents and cannot observe what a storefront emits. It is the
second clause here in that position, after [§4.1](#description-markdown)'s
renderer clause, and it is the one carrying a requirement ID — so it is recorded
in the conformance runner's `UNPINNED` list with its reason, rather than left to
look covered.

## <a id="security"></a>10. Security considerations

[Component §11](../../component/v1/spec.md#security) applies in full. What is
specific to a listing is that, alone among the three families, its content is
**rendered to other people**.

**The description is a stored-injection surface.** [§4.1](#description-markdown)
is the trust boundary, and [ADR 0004](../../../docs/adr/0004-listing-description-trust-boundary.md)
records why it is drawn where it is. Two things about it are security rules
rather than formatting ones:

The renderer obligation in [§4.1](#description-markdown) — that a consumer MUST
NOT emit an element, attribute, or URL the profile forbids, *whether or not it
validated the document first* — is the only rule in this specification that
constrains an implementation's output. It is stated that way deliberately.
Validation happens where a document is submitted; rendering happens wherever the
storefront runs, possibly against a document stored before a rule existed. A
renderer that trusts validation to have happened is a renderer that will emit
whatever is in the database.

The URL scheme rule covers `homepageUrl`, `sourceRepoUrl`, and `supportUrl` as
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
containment rule; the symlink and resolved-location requirements in
[blueprint §10](../../blueprint/v1/spec.md#security) apply identically. An
implementation MUST NOT decode or transcode a media file to validate it —
[§5](#media) turns on existence and containment, and nothing here requires an
image parser to be pointed at untrusted bytes.

**Text fields are unbounded in ways worth knowing.** `tags` and `license` are
free text that nothing checks ([§9](#known-debt)). A storefront MUST escape both
on render and MUST NOT treat `license` as an assertion about licensing — it is
an author's claim, not a verified fact.
