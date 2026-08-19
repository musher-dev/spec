# ADR 0002: Conformance case trees

- **Status:** Accepted
- **Date:** 2026-08-09
- **Extends:** [ADR 0001](0001-canonical-repository-architecture.md) §7

## Context

A conformance case is one `case.yaml`. That was enough while the corpus covered
the `parser` and `structural` phases, both of which decide a document by
reading the document.

The `semantic` phase does not. Of the twenty-four diagnostic codes the three
`spec.md` files now declare, eight are about a document's *surroundings*:

| Code | Needs |
|---|---|
| `ERR_SLUG_MISMATCH` | a directory with a name |
| `ERR_VERSION_MISMATCH` | a sibling document |
| `ERR_UNREFERENCED_COMPONENT` | the item's other files |
| `ERR_COMPONENT_NOT_FOUND`, `ERR_REFERENCE_ESCAPE` | a resolvable target |
| `ERR_UNKNOWN_OUTPUT`, `ERR_CONFLICTING_INPUT_SCHEMA` | the referenced component documents |
| `ERR_MEDIA_NOT_FOUND`, `ERR_PATH_ESCAPE` | a file on disk |

None is expressible as a single document, so none had a fixture. They reached
`main` as prose with CI green, which is the failure mode
[CONTRIBUTING.md](../../.github/CONTRIBUTING.md) ground rule 2 exists to prevent: "no
schema change without conformance fixtures."

The rules themselves are not in doubt. Blueprint §3.1 defines the **item root**
and every one of these codes is measured against it. What was missing is a way
for a fixture to *have* an item root.

GOVERNANCE.md lists "Changing the conformance fixture contract" among the
changes needing an ADR. This is that change.

## Decision

### 1. A case directory MAY carry a `tree/` instead of a `case.yaml`

The two forms are mutually exclusive, and the distinction is normative rather
than a convenience.

```
conformance/blueprint/v1/semantic/003-slug-disagrees-with-directory/
  metadata.json
  diagnostics.json
  tree/
    acme-wiki/
      blueprint.yaml
      listing.yaml
      components/
        postgres.yaml
```

`metadata.document` names the document under test as a path relative to
`tree/` — here `acme-wiki/blueprint.yaml`. The **item root** is the directory
containing that document.

`tree/` is the parent of the item root, not the item root itself. The extra
level is load-bearing: `ERR_SLUG_MISMATCH` compares `metadata.slug` against the
item directory's *name*, so a fixture that tested it needs a directory it can
name. A tree that was itself the item root could only ever be called `tree`.

### 2. `case.yaml` keeps its meaning, and it is not "the old form"

Blueprint §3.1 says a document handed over without a directory has no item root,
and that an implementation in that position MUST NOT report any rule measured
against one. That is a real state — a document submitted over an API — and
`case.yaml` is how the corpus expresses it.

So a `case.yaml` fixture asserts more than "these are the contents". It asserts
*there is no item root*, and an adapter that invents one for it is wrong. A case
declaring both forms is malformed.

**Rejected:** making `tree/` the only form and giving every case a synthetic
item root. It would have made the no-directory rule untestable, replacing one
blind spot with another.

### 3. Symlinks are declared in metadata, not committed

`ERR_PATH_ESCAPE` is, after listing §5's grammar landed, reachable only by
symlink: `..` is unspellable, so a media path escapes the item root only when a
legal spelling resolves to an illegal target.

A committed symlink is a poor fixture. It does not survive a Windows checkout
without `core.symlinks`, it is invisible in a diff, and a corpus shipped in a
release tarball would carry a link pointing outside the archive.

`metadata.symlinks` declares them instead:

```json
{
  "symlinks": { "acme-wiki/media/icon.png": "../../../../etc/passwd" }
}
```

Keys are paths relative to `tree/`; values are the link targets, verbatim. An
adapter materialises the tree into a scratch location and creates the links
there. The target is deliberately not required to exist — a dangling link that
resolves outside the item root is still an escape, and containment is decided
on the resolved path.

**Rejected:** committing the symlinks with a `.gitattributes` exemption. It
moves the portability problem rather than solving it, and the fixture stops
being readable as data.

**Rejected:** a `capability`-style skip for path escape. The rule is decided
offline against the filesystem, which is what makes it `semantic`; declining to
test it would have been a statement about this repository's tooling, not about
the contract.

### 4. An adapter that cannot materialise a tree SKIPs, and MUST NOT pass

This is the rule the README already states for an unimplemented phase, extended
to an unsupported case shape. A tree case is skipped, reported as skipped, and
never reported as passed.

### 5. `tools/` implements the `semantic` phase

`tools/src/validator.ts` previously asserted that the `semantic` phase "belongs
to a shared implementation library … not in scope for this repository, per
ADR 0001". That reading is wrong and this ADR corrects it.

ADR 0001 §6 forbids publishing a reference validator: no binary, no shared
library, no WebAssembly module, no language bindings. ADR 0001 §7 separately
describes `tools/` as one non-normative adapter over the corpus, confined to its
own directory. Implementing more phases inside that adapter publishes nothing
and blesses nothing. It only means the fixtures in this repository are executed
rather than declared.

The alternative was a corpus in which every `semantic` clause — acyclicity, the
floating-tag blocklist, the media rules — was checked by nothing at all. A
specification whose own CI cannot tell whether its fixtures are right is in a
worse position than one that admits a language affinity in a directory already
marked non-normative.

`capability` stays unimplemented. It needs an account, a region and a quota,
which is a server, and no amount of local tooling substitutes for one.

## Consequences

**Positive**

- The eight tree-shaped codes become testable, and the corpus can state what it
  covers without an asterisk.
- The `semantic` phase is executed in CI, so a clause and its fixture can
  disagree loudly instead of quietly.
- The no-item-root rule gains a fixture shape of its own, having previously been
  the accidental default.

**Negative**

- Every downstream adapter must now handle two case shapes, and materialise a
  tree with symlinks to run the full corpus. An adapter may skip the tree cases
  and still be honest about it, but it is not conformant while it does.
- Release tarballs grow. `release.yml` already ships
  `conformance/<family>/<major>`; it now ships directories inside it.
- `tools/` carries more non-normative code, and more of it is the kind that
  could drift from the prose. The reverse coverage gate added alongside this ADR
  — every declared diagnostic code needs a fixture or an allowlist entry stating
  why not — is what keeps that drift visible.

## Follow-ups

1. Author the fixtures this ADR unblocks; `ERR_UNKNOWN_COMPONENT` stays
   uncovered because it is `capability`.
2. Reconcile the three points where the specification and the platform
   deliberately disagree — cycle detection, parameter-merge conflicts, and
   whether a `SERVICE` must expose an endpoint — before v1 is declared stable.
