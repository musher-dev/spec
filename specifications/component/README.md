# Component specification

A component document describes one reusable node of a blueprint's component
graph ([blueprint §4](../blueprint/v1/spec.md#components)): a workload Musher
runs, or an external service, plus the configuration contract it exposes. A component
is never deployed on its own; a [blueprint](../blueprint/README.md) composes it.

Component documents sit inside a
[catalog item](../core/v1/spec.md#item-directory) rather than naming one, commonly
as `components/<name>.yaml`, `component.yaml` or `component-<name>.yaml`, the
patterns [editors bind](../../docs/using-schemas.md#in-your-editor).

## Versions

| Major | Specification | Examples | Released? |
|---|---|---|---|
| `v1` | [`v1/spec.md`](v1/spec.md) | [`v1/examples/`](v1/examples/) | Draft — no `component/v1.*` tag yet ([how to tell](../../docs/publication.md#draft-or-released)) |

## Start here

1. The [core specification](../core/README.md), which this one applies
2. [§2 Document envelope](v1/spec.md#envelope), for what this family binds
3. [§5 The component's shape](v1/spec.md#workload), including
   [§5.6 External components](v1/spec.md#external)
4. [§6 Configuration contract](v1/spec.md#contract), including
   [§6.3 Value schemas](v1/spec.md#value-schema)
5. [§8 Diagnostics](v1/spec.md#diagnostics)

An implementation implements every section of this specification and of each
specification it builds on, together with the external specifications they cite.
This one cites [RFC 5321](https://www.rfc-editor.org/rfc/rfc5321), [RFC
3986](https://www.rfc-editor.org/rfc/rfc3986), [RFC
1123](https://www.rfc-editor.org/rfc/rfc1123) and the [IANA Time Zone
Database](https://www.iana.org/time-zones). The list above is where to begin,
not what to implement.

## Builds on

Core v1. [Blueprint](../blueprint/README.md) in turn applies this family. The
authoritative list is the "Normative dependencies" table in
[§2](v1/spec.md#envelope).

## Requirement IDs

| Prefix | Covers | Section |
|---|---|---|
| `COMP-EXT` | Workload or external node | [§5](v1/spec.md#workload), [§5.6](v1/spec.md#external) |
| `COMP-SRC` | Image source | [§5.1](v1/spec.md#source) |
| `COMP-EP` | Endpoints, and what refers to them | [§5.2](v1/spec.md#endpoints) |
| `COMP-ENVVAR` | Environment variables | [§5.3](v1/spec.md#env-vars) |
| `COMP-UI` | Install-form presentation | [§6.1](v1/spec.md#inputs), [§6.4](v1/spec.md#install-form) |
| `COMP-GEN` | Generated inputs | [§6.1](v1/spec.md#inputs) |
| `COMP-OUT` | Outputs | [§6.2](v1/spec.md#outputs) |
| `COMP-VAL` | Value schemas | [§6.3](v1/spec.md#value-schema) |

Every ID, the clause stating it, and the cases pinning it:
[component/v1 in docs/traceability.md](../../docs/traceability.md#componentv1).

## Schema

| | URL |
|---|---|
| Major-version alias | `https://specifications.musher.dev/component/v1/component.schema.json` |
| Exact release (after first release) | `https://specifications.musher.dev/component/v1.<MINOR>.<PATCH>/component.schema.json` |

Which one to use, and how to bind it, is in
[Using the schemas](../../docs/using-schemas.md). The schema is authored in
[`v1/schemas/src/`](v1/schemas/src/) and built with `task bundle`.
