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
beyond the [DCO](.github/CONTRIBUTING.md#sign-your-work) is required.

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

One narrow exception applies before a family's first release.
[ADR 0005](docs/adr/0005-platform-divergence-reconciliation.md) §1 sets it out:
while a family has no published version, requirements 2 and 3 do not apply,
because the compatibility guarantee is stated against a released version and
there is none to run from. Requirement 1 still applies, as does declaring the
change as breaking. The exception closes for a family the moment its first tag
is created.

## Changing a controlled vocabulary

A field whose value comes from a closed `enum` is a controlled vocabulary this
repository decides — [ADR 0003](docs/adr/0003-controlled-vocabulary-placement.md)
§1 calls it placement one. Adding a term is a minor release; removing one is
breaking, and therefore a new major.

That asymmetry is the whole problem. Growth is cheap in every individual case
and irreversible in aggregate, so the rule below is editorial rather than
technical: nothing in CI can fail a term that is merely a bad idea.

### An open taxonomy: listing `category`

A candidate term must justify itself **against the terms that already exist**,
and the proposing pull request must say so in three parts:

1. **Which existing terms it was tested against**, and why each is wrong for the
   listings it is meant to hold. A term proposed without this reads as an
   addition; with it, it reads as a gap.
2. **That it is how a buyer browses, not what the software is built with.** A
   category answers "what am I looking for". The technology an item is made of
   is what `tags` carries, and a term that would have been a good tag is not a
   category.
3. **That it is not a subset of an existing term.** A term that splits an
   existing one in two makes both less useful, because a listing that could sit
   in either now sits in whichever its author picked.

Approval is one maintainer, as for any ordinary change. What is not ordinary is
that a reviewer is expected to reject a well-formed term on editorial grounds —
a taxonomy is judged by what it excludes, and twenty categories is a taxonomy
while sixty is a list with none.

**There is no numeric ceiling, and the reason is worth stating.** A cap would be
honoured only by refusing every candidate once it was reached, because the
alternative — merging two terms to make room — is a removal and therefore a new
major. A limit that cannot be enforced within the major it applies to is a limit
in name, and it would displace the judgement that actually does the work.

### A closed progression: listing `lifecycleStage`

`lifecycleStage` is not a taxonomy and does not share the rule above. It is a
short ordered progression describing maturity, and its terms are not
alternatives an author chooses between on taste — each one makes a claim about
the item that the storefront acts on.

Adding a stage therefore changes what the storefront *means*, not how it sorts,
and needs an **accepted ADR** rather than the admission test. The same is true
of any other vocabulary of this shape.

## Release process

Releases are automated. Merging a Conventional Commit to `main` opens a
release-please PR; merging that PR tags the release and triggers publication.

1. The release pull request records the pending version in
   [`published.json`](published.json) — its path and the checksums of the bytes
   about to be tagged
2. Tag `<family>/v<MAJOR>.<MINOR>.<PATCH>` is created
3. A `.tar.gz` of the bundle, prose, and conformance suite is built with
   SHA-256 checksums and a SLSA provenance attestation
4. The archive is attached to a GitHub Release
5. The schema is published to `https://schemas.musher.dev/<family>/…`, rebuilt
   from the tag rather than from `main`, with the cache policy for its path
   generated alongside it
6. `catalog.json` is regenerated for editor discovery

Released versions are **immutable**. Tag deletion and update are blocked by
repository ruleset, and `published.json` is append-only — a rewritten tag or an
edited entry fails CI and stops the deploy rather than silently altering a URL
documented as permanent. A flawed release is corrected by publishing a
superseding patch, and the flawed version is marked with `deprecated: true` plus
HTTP `Deprecation` and `Sunset` headers pointing at the migration guide.

[ADR 0006](docs/adr/0006-publication-from-tags.md) sets out the publication
model and why the ledger exists.

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

## Tooling dependencies

Everything under `tools/` is non-normative and is never published. A dependency
there is a development and CI tool, not part of the contract, and nothing it
produces is distributed.

One is worth naming explicitly. [`@sourcemeta/jsonschema`](https://github.com/sourcemeta/jsonschema)
is **AGPL-3.0**, and it is used to meta-validate the schemas and to cross-check
every structural verdict against Blaze — a second, independent implementation of
JSON Schema 2020-12. Two validators agreeing is the point: everything else here
asks Ajv, so a schema Ajv reads differently from everyone else would pass every
gate and fail in the SDKs.

Using it as a CI tool does not place this repository's schemas or prose under
the AGPL, and no artifact this repository publishes derives from it. A
contributor without it sees the checks report themselves as skipped rather than
passed.

One more is worth naming, for a different reason.
[`wrangler`](https://github.com/cloudflare/workers-sdk) uploads the publication
tree to Cloudflare Pages, which makes it the only dependency here that is handed
a credential. It is pinned to an exact version in `tools/package.json` and the
lockfile rather than fetched at deploy time, so the code that receives the token
changes only through a reviewed diff under CODEOWNERS. Nothing else in `tools/`
holds a secret, and nothing published derives from wrangler either.

## Security

See [SECURITY.md](.github/SECURITY.md).
