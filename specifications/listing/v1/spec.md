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

`metadata` carries `slug` and `version` — the same shape the sibling blueprint
carries, and the two MUST agree.

| Rule | Diagnostic |
|---|---|
| `metadata.slug` MUST equal the item directory name. | `ERR_SLUG_MISMATCH` |
| `metadata.version` MUST equal the sibling blueprint's `metadata.version`. | `ERR_VERSION_MISMATCH` |

Both are `semantic`, and both are measured against the item root defined in
[blueprint §3.1](../../blueprint/v1/spec.md#item-directory). A listing handed
over with no directory has no item root, and an implementation in that
position MUST NOT report either rule.

**The two documents are one item's two halves.** A listing whose version has
moved ahead of its blueprint describes something other than what would be
installed — this release's storefront copy over last release's graph. The rule
is what keeps "read about this" and "install this" the same thing.

The version rule needs a blueprint to compare against. An item whose listing
is `listingKind: COMPONENT` need not contain one; where there is no sibling
blueprint the rule has nothing to compare and does not apply.

> **TODO** — What `metadata.version` agrees with in a `COMPONENT` item, which
> has no blueprint. The component documents each carry their own
> `metadata.version` and an item may hold more than one, so this is not the
> same rule with a different sibling.

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
defined in [blueprint §3.1](../../blueprint/v1/spec.md#item-directory).

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
