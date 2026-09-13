# Listing specification

A listing document describes the catalog storefront entry for a blueprint or
component item: how it is presented, categorised, and discovered. It carries
presentation only, and is never an input to deployment.

A listing is an item document, `listing.yaml`, at the root of the catalog item
it presents.

## Versions

| Major | Specification | Examples | Released? |
|---|---|---|---|
| `v1` | [`v1/spec.md`](v1/spec.md) | [`v1/examples/`](v1/examples/) | [Draft or released](../../docs/publication.md#draft-or-released) |

## Read in this order

1. The [core specification](../core/README.md), which this one applies
2. [§2 Document envelope](v1/spec.md#envelope), for what this family binds
3. [§3 Identity](v1/spec.md#identity)
4. [§4 Presentation](v1/spec.md#presentation), including
   [§4.1 The description Markdown profile](v1/spec.md#description-markdown)
5. [§5 Media](v1/spec.md#media) and [§7 Diagnostics](v1/spec.md#diagnostics)

## Builds on

Core v1. The authoritative list is the "Normative dependencies" table in
[§2](v1/spec.md#envelope).

## Requirement IDs

| Prefix | Covers | Section |
|---|---|---|
| `LIST-MD` | The description Markdown profile | [§4.1](v1/spec.md#description-markdown) |
| `LIST-MEDIA` | Media paths and their resolution | [§5](v1/spec.md#media), [§5.1](v1/spec.md#media-resolution) |

Every ID, the clause stating it, and the cases pinning it:
[listing/v1 in docs/traceability.md](../../docs/traceability.md#listingv1).

## Schema

| | URL |
|---|---|
| Major-version alias | `https://specifications.musher.dev/listing/v1/listing.schema.json` |
| Exact release | `https://specifications.musher.dev/listing/v1.<MINOR>.<PATCH>/listing.schema.json` |

Which one to use, and how to bind it, is in
[Using the schemas](../../docs/using-schemas.md). The schema is authored in
[`v1/schemas/src/`](v1/schemas/src/) and built with `task bundle`.
