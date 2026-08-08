# ADR 0001: Canonical repository architecture for the Musher specification

- **Status:** Accepted
- **Date:** 2026-08-08
- **Supersedes:** the `musher-dev/specs` repository

## Context

Musher's user-authored documents had no normative definition. Three
independent, mutually unaware descriptions existed:

1. `musher-dev/specs` — a `bundle-definition` JSON Schema for the agent-bundle
   format the platform no longer ships. One commit, no CI, no license, no
   runner. Its `schemas.musher.dev` URLs were never served.
2. `platform/apps/api/docs/schemas/catalog-{component,blueprint,listing}.v1.json`
   — the real, current contract, but generated code-first from Pydantic wire
   models and referenced from seed YAML by fragile relative paths
   (`../../../../docs/schemas/…`).
3. `platform/apps/api/src/composition/routing/cross_cutting/schemas.py` — a
   runtime `/v1/schemas` endpoint serving `model_json_schema()` output.

Generating a public contract from implementation models leaks serialization
details into the specification, produces titles like `Specversion` and
`SeedComponentDocument`, and makes structural validation depend on the
availability of the control plane. ADR 0113 in `musher-dev/platform` already
anticipated the fix: *"the format doubles as the contract for the future
standalone catalog-listings repo synced to the platform."*

This ADR establishes that repository.

## Decision

### 1. Schema-first, in a dedicated repository

`musher-dev/spec` holds the normative JSON Schema 2020-12 documents,
normative prose, and the conformance suite. Implementation repositories are
downstream. Where an implementation and the conformance suite disagree, the
implementation is defective.

`musher-dev/specs` is superseded and will be deleted. It is not renamed —
its only content described a retired concept.

### 2. Three independently versioned families

`component`, `blueprint`, and `listing`, matching the `kind` discriminator of
the documents they define. Each has its own directory tree, its own conformance
suite, and its own release train.

They share the `{ specVersion, kind, metadata, spec }` envelope. Each family's
root schema constrains `kind` to its own constant, so the envelope is expressed
per family rather than shared through a cross-family `$ref` — this keeps each
published bundle self-contained and each family independently releasable.

**Rejected:** a single `catalog` family covering all three kinds. It would
force lockstep releases on documents that change at different rates.

**Rejected:** a k8s-style `apiVersion: musher.dev/v1` envelope. Platform
ADR 0113 rejected it explicitly — `specVersion` is already the platform's
document-format discriminator, and one convention beats two. The
`apiVersion`/`kind: App` shape in `musher-cli/internal/deployspec` predates
that decision and is not a contract this repository ratifies.

### 3. Modular source, generated bundle

Maintainers author `schemas/src/*.schema.json`. CI compiles them into a single
self-contained compound schema document at `schemas/dist/<family>.schema.json`
and fails if the committed bundle differs from a fresh compile.

Consumers only ever see the bundle. No published schema resolves a `$ref` over
the network — that would break offline and air-gapped validation, hang IDEs on
a slow origin, and hand every validator an SSRF primitive.

### 4. `v<MAJOR>` directories, SemVer tags

The directory is the compatibility epoch. Exact releases are git tags
`<family>/v<MAJOR>.<MINOR>.<PATCH>`. Released versions are immutable; tag
deletion is blocked by repository ruleset. A flaw is corrected by a superseding
patch, never by rewriting a tag.

Documents declare `specVersion: v1` — a compatibility family, not an exact
schema. Validators evaluate against the newest `v1.x.y` they hold.

### 5. Static publication, not an API endpoint

Schemas are published to `https://schemas.musher.dev/` from a GitHub Pages
artifact fronted by Cloudflare, which supplies the immutable cache headers
Pages cannot set itself.

The platform's `/v1/schemas` endpoint is **not** the distribution channel for
authoring schemas. It remains appropriate for dynamic, account-scoped
capability data and for API payload schemas. Binding manifest authoring to
control-plane availability degrades local, CI, and air-gapped workflows for no
benefit.

### 6. Data artifacts only

No reference validator binary, no shared validation library, no WebAssembly
module, no generated language bindings. See GOVERNANCE.md → Binary policy.

### 7. Language-neutral conformance

Conformance is a corpus of data fixtures — `metadata.json`, `case.yaml`,
`diagnostics.json` — not an executable runner. Each implementation writes its
own thin adapter. Diagnostic codes and the failing phase are normative;
human-readable error text is not.

Tooling under `tools/` is TypeScript on Bun. It is explicitly non-normative and
confined to that directory, with its own `package.json`, so the normative tree
carries no language affinity.

## Consequences

**Positive**

- One authority. Structural validation works offline, in CI, and air-gapped.
- Implementation languages can no longer redefine the public contract by
  accident.
- Immutable, checksummed, attested release artifacts make historical validation
  reproducible.

**Negative**

- Downstream teams must each build a conformance adapter. This is the price of
  language neutrality and is paid once per implementation.
- The platform must invert its generator: `check_catalog_manifests.py` changes
  from emitting schemas to verifying its models against the published bundle.
- Two release trains must stay coordinated — a schema release, then downstream
  adoption.

**Debt accepted at bootstrap**

The seeded schemas retain Pydantic-derived `$defs` names (`SeedItemMetadata`,
`ComponentSpecRequest`) and mangled auto-titles (`Specversion`). Renaming them
is a breaking change to `$ref` targets and is scheduled before `v1` is declared
stable, not at bootstrap, so that the initial import stays a mechanical,
reviewable diff against the platform's generated output.

## Follow-ups

1. Create the `schemas.musher.dev` DNS record and cache rule in
   `musher-dev/infra`.
2. Invert the platform generator to verify against the published bundle.
3. Regenerate the public docs field reference from these schemas, replacing the
   hand-written tables and the stale bundle-format page.
4. Clean `$defs` naming before declaring `v1` stable.
5. Submit `catalog.json` to SchemaStore once `v1` reaches beta.
