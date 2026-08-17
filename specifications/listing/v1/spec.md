# Musher Listing Document — Specification v1

**Status:** Draft (pre-stable)
**Family:** `listing`
**Schema:** `https://schemas.musher.dev/listing/v1/listing.schema.json`

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as
described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

> **This document is normative.** Where it disagrees with a `description` field
> in the JSON Schema, this document wins.

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

| Rule | Diagnostic |
|---|---|
| `metadata.slug` MUST equal the item directory name. | `ERR_SLUG_MISMATCH` |
| Where the item holds a blueprint, `metadata.version` MUST equal its `metadata.version`. | `ERR_VERSION_MISMATCH` |

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

`description` is Markdown, at most 20 000 characters.

> **TODO** — The permitted Markdown subset for `description`. This one is a
> security question rather than an undocumented behaviour: neither this
> specification nor any implementation constrains the subset today, and a
> storefront rendering untrusted Markdown from a third-party listing is an
> injection surface. Raw embedded HTML, `javascript:` URLs, and remote image
> references are the three that need deciding.

> **TODO** — `category` and `lifecycleStage` are controlled vocabularies. State
> the governance rule for adding a term — this is the field most likely to need
> extension, and unmanaged growth makes the storefront incoherent. Note that
> adding a term is a minor release and removing one is major, since narrowing
> an enum rejects a document that validated before.

Featured-row placement is **not** part of this contract. A listing document
MUST NOT declare `spec.featured`; promotion is a storefront-operator action,
not an authoring one. A document that declares it is rejected in the
`structural` phase with `ERR_UNKNOWN_FIELD`, like any other unknown property —
accepting it silently would let an author believe they had promoted their own
listing.

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

| Rule | Diagnostic |
|---|---|
| The path MUST resolve to a file that exists. | `ERR_MEDIA_NOT_FOUND` |
| The resolved target MUST lie inside the item root. | `ERR_PATH_ESCAPE` |
| Two screenshots MUST NOT share a basename. | `ERR_DUPLICATE_MEDIA_BASENAME` |

**`ERR_PATH_ESCAPE` outlives the grammar.** The pattern above makes `..`
unspellable, so no path can escape by traversal any more. One can still escape
by symlink — `media/icon.png` pointing outside the item is a legal spelling
resolving to an illegal target. Containment is a property of the resolved
location rather than of the string, the same distinction
[blueprint §4.1](../../blueprint/v1/spec.md#component-reference) draws for a
component reference.

**Basenames must differ across the whole item**, not merely within a
directory: `media/desktop/overview.png` and `media/mobile/overview.png`
collide. Published assets are addressed by basename, so two files called
`overview.png` are one file. The constraint is a real one on an author and is
stated here rather than left to be found out when the second screenshot
silently replaces the first.

**What v1 does not constrain.** Neither dimensions nor file size are bounded.
A storefront cannot reserve space for an image whose aspect ratio it does not
know, so this is a gap rather than a permission — but bounding either one
rejects listings that validate today, which makes closing it a breaking
change.

## <a id="validation-layers"></a>6. Validation layers

As defined in [component §7](../../component/v1/spec.md#validation-layers).

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

## <a id="conformance"></a>8. Conformance

An implementation conforms when it produces the declared outcome for every
fixture in [`conformance/listing/v1/`](../../../conformance/listing/v1/).

## <a id="known-debt"></a>9. Known debt

Seeded from the platform's generated schema. The naming that arrived with it
has been cleaned, and the seed-authoring-only `featured` block has been removed
from the contract (§4). The sections above marked TODO remain. See
[component §10](../../component/v1/spec.md#known-debt).
