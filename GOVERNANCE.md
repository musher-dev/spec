# Governance

## Scope of this repository

This repository contains **implementation-independent, public-facing Musher
contracts** and nothing else.

**In scope**

- Normative specification prose
- JSON Schema 2020-12 documents for user-authored documents
- Language-neutral conformance fixtures
- Migration rules between specification versions
- Architecture decision records covering the above

**Out of scope**

- Internal persistence or desired-state schemas → `musher-dev/platform`
- API request/response and OpenAPI documents → `musher-dev/platform`
- Generated language bindings (Go structs, TypeScript types, Rust traits) →
  the respective SDK and implementation repositories
- Executable binaries, reference validators, and WebAssembly modules — see
  [Binary policy](#binary-policy)

## Roles

**Maintainers** review and merge changes, cut releases, and arbitrate
specification disputes. Current maintainers are listed in
[`.github/CODEOWNERS`](.github/CODEOWNERS).

**Contributors** are anyone opening an issue or pull request. No agreement
beyond the [DCO](CONTRIBUTING.md#sign-your-work) is required.

## Decision process

Ordinary changes — a new optional field, a corrected description, an additional
conformance fixture — need one maintainer approval and green CI.

Structural changes need an accepted ADR first. That covers:

- Adding or removing a specification family
- Changing the release, versioning, or publication model
- Any change requiring a new major version
- Changing the conformance fixture contract

ADRs live in [`docs/adr/`](docs/adr/), are numbered sequentially, and are
immutable once accepted — supersede, never rewrite.

## Compatibility review

Any change that would cause a previously valid document to fail validation is a
**breaking change**. It requires:

1. Explicit approval from a maintainer listed in CODEOWNERS
2. A new `v<N>` major directory — the previous major keeps working unchanged
3. A migration note in the new major's `spec.md`

Adding a required field, narrowing an enum, tightening a pattern, and removing
a field are all breaking. Adding an optional field is not.

## Release process

Releases are automated. Merging a Conventional Commit to `main` opens a
release-please PR; merging that PR tags the release and triggers publication.

1. Tag `<family>/v<MAJOR>.<MINOR>.<PATCH>` is created
2. A `.tar.gz` of the bundle, prose, and conformance suite is built with
   SHA-256 checksums and a SLSA provenance attestation
3. The archive is attached to a GitHub Release
4. The schema is published to `https://schemas.musher.dev/<family>/…`
5. `catalog.json` is regenerated for editor discovery

Released versions are **immutable**. Tag deletion is blocked by repository
ruleset. A flawed release is corrected by publishing a superseding patch, and
the flawed version is marked with `deprecated: true` plus HTTP `Deprecation`
and `Sunset` headers pointing at the migration guide.

## Deprecation and retirement

1. **Deprecate** — the field or version is annotated `deprecated: true`. Editors
   and the CLI surface a warning. It keeps working.
2. **Sunset** — a removal date is published via the `Sunset` header. Minimum
   six months from deprecation.
3. **Retire** — removal happens only in a new major version. Migration rules
   ship alongside it.

## Binary policy

This repository publishes **data artifacts only**: JSON Schema documents,
Markdown prose, and conformance fixture archives.

It deliberately does not publish a reference validator binary, a shared
validation library, WebAssembly modules, or generated language packages. A
reference implementation becomes the de facto standard, hides normative
behaviour inside compiled code, biases the specification toward one language's
standard library, and saddles this repository with production security
patching. Implementations conform to the prose and the fixtures — not to the
behaviour of a blessed executable.

## Security

See [SECURITY.md](SECURITY.md).
