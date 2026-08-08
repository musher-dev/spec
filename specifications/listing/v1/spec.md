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
[component §2](../../component/v1/spec.md#envelope) apply identically.

Do not confuse `kind` with `spec.listingKind`. `kind` identifies the document
format; `listingKind` identifies what the listing points at (`BLUEPRINT` or
`COMPONENT`).

## <a id="identity"></a>3. Identity

> **TODO** — `metadata.slug` MUST equal the item directory name and MUST agree
> with the sibling blueprint document. `metadata.version` MUST agree likewise.
> Both are `semantic`-phase rules.

## <a id="presentation"></a>4. Presentation

> **TODO** — Define the rendering contract for `summary` and `description`:
> `summary` is plain text of bounded length; `description` is Markdown, and the
> permitted subset MUST be stated (a storefront rendering untrusted Markdown is
> an injection surface).

> **TODO** — `category` and `lifecycleStage` are controlled vocabularies. State
> the governance rule for adding a term — this is the field most likely to need
> extension, and unmanaged growth makes the storefront incoherent.

## <a id="media"></a>5. Media

`icon` and `screenshots[].file` are paths relative to the listing document.

> **TODO** — Normative constraints: paths MUST be relative, MUST NOT escape the
> item directory (`..` rejected), MUST resolve to a file that exists, and MUST
> be one of a stated set of image formats. Dimension and size bounds SHOULD be
> specified so the storefront can render without layout shift.

Path containment is a `semantic`-phase rule; JSON Schema can constrain the
string shape but cannot confirm the target exists inside the item directory.

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
| `ERR_PATH_ESCAPE` | `semantic` | A media path escapes the item directory. |

## <a id="conformance"></a>8. Conformance

An implementation conforms when it produces the declared outcome for every
fixture in [`conformance/listing/v1/`](../../../conformance/listing/v1/).

## <a id="known-debt"></a>9. Known debt

Seeded from the platform's generated schema; `$defs` retain `Seed…` affixes,
and `SeedListingFeatured` encodes a seed-authoring-only concern that may not
belong in the public contract. See
[component §10](../../component/v1/spec.md#known-debt).
