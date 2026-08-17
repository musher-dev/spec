# Security Policy

## Reporting a vulnerability

Report security issues privately through
[GitHub Security Advisories](https://github.com/musher-dev/spec/security/advisories/new),
or by email to **security@musher.dev**.

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
- **Supply chain integrity** — a mismatch between a release tarball, its
  published SHA-256 checksum, and its SLSA provenance attestation.
- **Vulnerabilities in `tools/`**, which run in CI with repository credentials.

Specification design disagreements are not security issues. Open a normal issue.

## Verifying a release

Every release attaches a `.tar.gz`, a matching `.sha256`, and a SLSA provenance
attestation.

```sh
# Checksums
sha256sum --check component-v1.0.0.tar.gz.sha256

# Provenance
gh attestation verify component-v1.0.0.tar.gz --repo musher-dev/spec
```

A published schema can be verified without downloading a release. Each
exact-version URL has a `.sha256` beside it, and
[`published.json`](https://schemas.musher.dev/published.json) records the
checksum of every version ever released:

```sh
curl -sO https://schemas.musher.dev/component/v1.0.0/component.schema.json
curl -s https://schemas.musher.dev/component/v1.0.0/component.schema.json.sha256 \
  | sha256sum --check -
```

A pinned URL whose bytes do not match what `published.json` records is a
supply-chain report, not a bug — see below.

## Supported versions

Security fixes are issued for the latest patch of every non-retired major
version of each family. Retired majors receive no fixes; migrate.
