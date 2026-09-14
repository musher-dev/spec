# Repository conventions

This page names **repository artifacts**: directories, schema modules, bundles,
identifiers, and conformance cases. What a **field**, a **value**, or a
user-authored **mapping key** is called is decided by
[ADR 0007](adr/0007-naming-conventions.md) instead: `camelCase` properties,
`UPPER_SNAKE_CASE` enum values, `kind` for the document family and `type` for
every other discriminator, adjectives rather than `is…` booleans, plural
collections, `…Ref` references, correctly spelled units, and a named grammar for
every identifier.

## Naming table

| Thing | Rule | Example |
|---|---|---|
| Directories | lowercase kebab-case; plural for categories, singular for concepts | `specifications/component/` |
| Schema modules | `<concept>.schema.json` | `component.schema.json` |
| Bundle | `<family>.schema.json` — never a bare `schema.json` | `blueprint.schema.json` |
| Version directory | `v<MAJOR>` | `v1` |
| Source `$id` | `https://specifications.musher.dev/<family>/v<MAJOR>/<concept>` — extensionless, no trailing slash. Source modules are never served, so this is an identity, not a fetch URL. | `…/component/v1/component` |
| Bundle `$id` | The real publication URL, set by the bundler at build time. Do not write it by hand. | `…/component/v1/component.schema.json` |
| `$defs` keys | UpperCamelCase, naming the concept. No `Seed` prefix, no `Request` suffix — those describe a platform pipeline, not a document contract. | `ComponentWorkload` |
| `title` | Module root only. Below the root, the key already names the field; use `description` to say what it means. | `Musher Component Document` |
| Conformance case ID | `<phase>-<NNN>-<description>` | `structural-001-minimal-valid` |
| Conformance case directory | `<phase>/<NNN>-<description>/`, under the corpus | `structural/001-minimal-valid/` |

## Enforcement

These rules are checked, so do not work around them.

- `tools/src/schema/lint.ts`, run by `task check:schema`, checks each authored
  module: its file name, its `$id`, its `$defs` keys, and where it places
  `title`.
- Family discovery refuses a family directory that is not lowercase kebab-case.
- `task check:conformance` refuses a case whose ID does not lead with its phase
  and a hyphen, whose `metadata.json` ID differs from its `cases.json` entry, or
  whose phase the two disagree on. It does not check the `<NNN>-<description>`
  part, or that the directory matches the ID; review holds those.

## Conformance case IDs

A case ID leads with its phase, and the rest of it names the case's directory
inside that phase's directory. How a case
is laid out, indexed, and declared is defined in the
[conformance suite's fixture format](../conformance/README.md).
