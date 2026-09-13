# Documentation

Start from the [repository README](../README.md) if you are new. This page lists
every guide by who it is for.

## Consumers: validating documents

- [Using the schemas](using-schemas.md): which URL to use, editor binding,
  pinning, offline use, and verifying what you downloaded.
- [Draft or released](publication.md#draft-or-released): whether a version you
  are reading has been released.

## Implementers: building a parser or validator

- [Specifications](../specifications/README.md): the families, how they relate,
  and [what is normative](../specifications/README.md#what-is-normative).
- [Implementing a family](../specifications/README.md#implementing): the reading
  order and the corpora a conformance claim covers.
- [Conformance suite](../conformance/README.md): the fixture format every
  corpus follows, and the profiles an implementation claims.
- [Requirement traceability](traceability.md): every requirement ID, its clause,
  and its cases. Generated.

## Contributors: changing a specification

- [Contributing](../.github/CONTRIBUTING.md): environment, making a change,
  commit messages, and sign-off.
- [Repository conventions](conventions.md): how repository artifacts are named.
- [ADR 0007](adr/0007-naming-conventions.md): how fields and values are named.
- [Compatibility review](../GOVERNANCE.md#compatibility-review): what counts as
  a breaking change.

## Maintainers: releasing and operating

- [Publication](publication.md): from tag to release assets to the site, cache
  policy, and the ledger.
- [Governance](../GOVERNANCE.md): roles, decision process, and release policy.
- [Repository rulesets](../.github/rulesets/RULESETS.md): branch and tag
  protection, and the code-owner review gate.
- [Tool configuration](../.config/README.md): where every linter, formatter and
  hook config lives.
- [Security policy](../.github/SECURITY.md): reporting a vulnerability and
  verifying a release.

## Decisions

- [Architecture decision records](adr/): why the repository and the
  specifications are the way they are. An accepted ADR is not edited; it is
  superseded.
