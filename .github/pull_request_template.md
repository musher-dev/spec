## What changes

<!-- One paragraph. What does this alter about the contract? -->

## Why

<!-- Link the issue or ADR. Structural changes need an accepted ADR first. -->

## Compatibility

<!-- Delete the lines that do not apply. -->

- [ ] No schema change (docs, tooling, or CI only)
- [ ] **Additive** — new optional field. A document valid before is still valid.
- [ ] **Correction** — does not change what validates.
- [ ] **Breaking** — a previously valid document now fails.

A breaking change requires CODEOWNERS approval, a new `v<N>` directory, and a
migration note. Validation must never become stricter inside a major version.

## Checklist

- [ ] `task check` passes locally
- [ ] `schemas/dist/` regenerated with `task bundle` and committed (never edited by hand)
- [ ] Conformance fixtures added for every behavioural change, each citing a `clause`
- [ ] Normative prose updated in the affected `spec.md` — schema `description`s are explanatory, not normative
- [ ] Commit messages are Conventional and correctly scoped (the scope drives release-please)
- [ ] Commits are DCO signed off (`git commit -s`)
