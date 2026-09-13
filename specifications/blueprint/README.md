# Blueprint specification

A blueprint document describes a composition of components into one deployable
application: which components participate, how large each runs, and how they
are wired to one another. The blueprint is the unit of deployment.

A blueprint is an item document, `blueprint.yaml`, at the root of its catalog
item. The component documents it references sit inside the same item.

## Versions

| Major | Specification | Examples | Released? |
|---|---|---|---|
| `v1` | [`v1/spec.md`](v1/spec.md) | [`v1/examples/`](v1/examples/) | [Draft or released](../../docs/publication.md#draft-or-released) |

## Read in this order

1. The [core specification](../core/README.md) and the
   [component specification](../component/README.md), which this one applies
2. [§2 Document envelope](v1/spec.md#envelope), for what this family binds
3. [§3 Identity](v1/spec.md#identity)
4. [§4 Component graph](v1/spec.md#components), including
   [§4.2 Connections](v1/spec.md#connections)
5. [§5 Parameters](v1/spec.md#parameters) and
   [§7 Diagnostics](v1/spec.md#diagnostics)

## Builds on

Core v1 and component v1. The authoritative list is the "Normative
dependencies" table in [§2](v1/spec.md#envelope).

## Requirement IDs

| Prefix | Covers | Section |
|---|---|---|
| `BP-ID` | Item identity particular to a blueprint | [§3](v1/spec.md#identity) |
| `BP-CONN` | Connections | [§4.2](v1/spec.md#connections) |
| `BP-NODE` | Node compute and placement | [§4.3](v1/spec.md#node-compute), [§4.4](v1/spec.md#placement-constraints) |

Every ID, the clause stating it, and the cases pinning it:
[blueprint/v1 in docs/traceability.md](../../docs/traceability.md#blueprintv1).

## Schema

| | URL |
|---|---|
| Major-version alias | `https://specifications.musher.dev/blueprint/v1/blueprint.schema.json` |
| Exact release | `https://specifications.musher.dev/blueprint/v1.<MINOR>.<PATCH>/blueprint.schema.json` |

Which one to use, and how to bind it, is in
[Using the schemas](../../docs/using-schemas.md). The schema is authored in
[`v1/schemas/src/`](v1/schemas/src/) and built with `task bundle`.
