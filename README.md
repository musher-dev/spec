# Musher Specification

Canonical public contracts, normative schemas, and language-neutral conformance
suites for the [Musher](https://musher.dev) platform.

This repository is the source of truth. If an implementation disagrees with the
prose, the schemas, or the conformance fixtures published here, the
implementation is defective.

Each family's `spec.md` defines its complete behaviour. The JSON Schema bundle
is that prose's executable form for structural validity, and the conformance
corpus is its executable form for observable outcomes; all three are normative.
Schema `description` fields, examples, and validator message text are
informative. A disagreement between two normative artifacts is a defect here
that blocks a release, not a choice for an implementation.

## Specification families

Each family is an independently versioned document contract. All three share the
`{ specVersion, kind, metadata, spec }` envelope described in
[ADR 0001](docs/adr/0001-canonical-repository-architecture.md).

| Family | `kind` | Describes | Schema |
|---|---|---|---|
| [`component`](specifications/component/v1/) | `COMPONENT` | One reusable workload definition — source, runtime shape, health, and configuration contract. | [`component.schema.json`](specifications/component/v1/schemas/dist/component.schema.json) |
| [`blueprint`](specifications/blueprint/v1/) | `BLUEPRINT` | A composition of components into a single deployable application. | [`blueprint.schema.json`](specifications/blueprint/v1/schemas/dist/blueprint.schema.json) |
| [`listing`](specifications/listing/v1/) | `LISTING` | The catalog storefront entry for a blueprint or component. | [`listing.schema.json`](specifications/listing/v1/schemas/dist/listing.schema.json) |

## Using the schemas

### In your editor

Add a modeline to the top of the document:

```yaml
# yaml-language-server: $schema=https://schemas.musher.dev/component/v1/component.schema.json
specVersion: v1
kind: COMPONENT
```

Or bind by glob in VS Code `settings.json`:

```json
{
  "yaml.schemas": {
    "https://schemas.musher.dev/component/v1/component.schema.json": [
      "**/components/*.yaml",
      "**/component-*.yaml"
    ],
    "https://schemas.musher.dev/blueprint/v1/blueprint.schema.json": "**/blueprint.yaml",
    "https://schemas.musher.dev/listing/v1/listing.schema.json": "**/listing.yaml"
  }
}
```

### Pinning a version

| URL | Mutability | Use for |
|---|---|---|
| `https://schemas.musher.dev/component/v1/component.schema.json` | Moves within the v1 family | Editors, humans |
| `https://schemas.musher.dev/component/v1.2.0/component.schema.json` | Immutable forever | CI, automation, audit |

Automation MUST pin an exact version. Major-version aliases exist so editors
pick up backward-compatible additions without a config change; they are not a
stable target for a build.

Exact-version paths are rebuilt from their git tags on every deploy, never from
`main`, and each one carries its own `$id` naming that exact URL. Every release
is accompanied by a `.sha256` sidecar, `/<family>/versions.json` inventories
what a family has published, and [`published.json`](published.json) records the
checksum of every version this repository has ever released. See
[ADR 0006](docs/adr/0006-publication-from-tags.md).

Once a family is tagged its alias serves that family's newest release; before
its first tag the alias serves what is committed on `main`.

### Offline

Every published schema is a self-contained compound document — all `$ref`s
resolve inside `$defs`. No validator ever needs to make a network request to
evaluate a document. Download the tagged release tarball from
[Releases](https://github.com/musher-dev/spec/releases) and vendor it.

## Repository layout

```
specifications/<family>/v<major>/
  spec.md              normative prose
  schemas/src/         authored schema modules      (normative input)
  schemas/dist/        generated compound bundle    (normative output, committed)
  examples/            validated example documents
conformance/<family>/v<major>/
  cases.json           test-vector index
  <phase>/<case-id>/   metadata.json, case.yaml, diagnostics.json
tools/                 non-normative build and validation scripts (Bun + TypeScript)
docs/adr/              architecture decision records
docs/traceability.md   generated: every requirement, its clause, and its cases
published.json         the checksum of every version ever released
```

[`docs/traceability.md`](docs/traceability.md) is the map from a requirement
identifier to the clause stating it and the conformance cases pinning it. It is
generated, so it cannot drift from either.

`schemas/dist/` is generated. Never edit it by hand — CI regenerates it and
fails the build if your commit does not match.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).

```sh
task setup     # install tooling and git hooks
task check     # everything CI runs
task bundle    # regenerate schemas/dist/ after editing schemas/src/
```

## Versioning

Directories are compatibility epochs (`v1`); exact releases are git tags of the
form `<family>/v<MAJOR>.<MINOR>.<PATCH>` — for example `component/v1.2.0`.
Families version independently.

- **Minor** — new optional fields. Validation never becomes stricter within a
  major version.
- **Patch** — corrections that do not change what validates.
- **Major** — anything that makes a previously valid document invalid. Requires
  a new `v<N>` directory; the old one keeps working.

Released versions are immutable. A flawed release is superseded, never
overwritten.

## Status

`v1` is **pre-stable**, and nothing has been released — no tag exists and every
family reads `0.0.0`. The schemas here were seeded from the platform's
generated catalog schemas and have been brought up to specification quality:
the `$defs` names are settled, no `spec.md` carries a `TODO` section, and every
rule each one states is stated in prose with the schema implementing it.

What remains is recorded rather than outstanding. Each family's **Known debt**
section names its own gaps, and
[ADR 0005](docs/adr/0005-platform-divergence-reconciliation.md) §1 sets out the
window — open only until a family's first tag — in which a rule that rejects a
previously valid document can still be added without a new major.

## License

[Apache-2.0](LICENSE)
