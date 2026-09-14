# Security Policy

## Reporting a vulnerability

Report security issues privately through
[GitHub Security Advisories](https://github.com/musher-dev/specifications/security/advisories/new),
or by email to **<security@musher.dev>**.

Please do not open a public issue for a security report.

We aim to acknowledge within 3 business days and to provide a remediation
timeline within 10 business days.

## What counts as a vulnerability here

This repository ships data, not executables, so its threat surface is narrow
but real:

- **A schema pattern vulnerable to catastrophic backtracking (ReDoS).** A
  regular expression in a published schema that can be driven to exponential
  evaluation time by an attacker-controlled document.
- **A remote `$ref` in a published schema.** Published bundles must be
  self-contained. A remote reference turns every validator into an SSRF vector
  and a network dependency. CI rejects these; report any that reach a release.
- **A schema that accepts a document the specification forbids**, where the gap
  has a security consequence — for example accepting a path that escapes the
  project root, or an unpinned image reference.
- **Supply chain integrity** — a mismatch between a release asset, the digest
  GitHub records for it, the `bundleSha256` in `published.json`, the bytes
  served at its pinned URL, and its SLSA provenance attestation.
- **Vulnerabilities in `tools/`**, which run in CI with repository credentials.

Specification design disagreements are not security issues. Open a normal issue.

## Verifying a release

Every release is a published **immutable** GitHub Release. Once published, its
tag and assets cannot change, and GitHub records a digest for each asset. Which
assets each release carries is listed in
[Publication → Release assets](../docs/publication.md#release-assets). Every
asset has a SLSA provenance attestation.

```sh
# The release is published and immutable
gh release verify component/v1.0.0 --repo musher-dev/specifications

# A downloaded file matches the digest GitHub recorded for that asset
gh release verify-asset component/v1.0.0 component-v1.0.0.tar.gz --repo musher-dev/specifications

# Provenance
gh attestation verify component-v1.0.0.tar.gz --repo musher-dev/specifications
```

A schema served from `specifications.musher.dev` can be verified without the
release. Each exact-version URL has a `sha256sum`-format `.sha256` sidecar
beside it, and [`published.json`](https://specifications.musher.dev/published.json)
records each release's `bundleSha256`, the hash of those same bytes:

```sh
curl -sO https://specifications.musher.dev/component/v1.0.0/component.schema.json
curl -s https://specifications.musher.dev/component/v1.0.0/component.schema.json.sha256 \
  | sha256sum --check -
```

A pinned URL whose bytes do not match the release asset, or the `bundleSha256`
that `published.json` records, is a supply-chain report, not a bug — see below.

## Supported versions

Security fixes are issued for the latest patch of every non-retired major
version of each family. Retired majors receive no fixes; migrate.
