# Musher Specification Repository

This repository is the normative source of truth for Musher's public document
contracts. Everything downstream — the CLI, the platform API, every SDK — is an
implementation of what is defined here.

## Non-negotiables

1. **`specifications/*/v*/schemas/dist/` is generated.** Never edit it directly.
   Edit `schemas/src/*.schema.json`, then run `task bundle`. CI fails the build
   if the committed bundle does not byte-match a fresh compile.
2. **No remote `$ref`.** Every published bundle must be self-contained; all
   references resolve inside `$defs`. Remote references break offline
   validation, hang IDEs, and create an SSRF vector. `task check:schema`
   rejects them.
3. **No schema change without conformance fixtures.** A behavioural change
   needs a fixture that fails before it and passes after it.
4. **Validation never becomes stricter inside a major version.** Adding a
   required field, narrowing an enum, tightening a pattern, or removing a field
   are all breaking and require a new `v<N>` directory.
5. **No executables, no generated language bindings.** Data artifacts only. See
   GOVERNANCE.md → Binary policy.

## Layout

```
specifications/<family>/v<major>/
  spec.md              normative prose — the definitive behavioural rule
  schemas/src/         authored modules (normative input)
  schemas/dist/        generated compound bundle (normative output, committed)
  examples/            example documents, validated in CI
conformance/<family>/v<major>/
  cases.json           index of test vectors
  <phase>/<case-id>/   metadata.json + case.yaml + diagnostics.json
tools/src/*.ts         non-normative Bun scripts — the only language-bound code
docs/adr/              architecture decision records
```

Three families, versioned independently: `component`, `blueprint`, `listing`.

## Naming rules

Enforced by `tools/src/lint.ts` — do not work around them.

| Thing | Rule | Example |
|---|---|---|
| Directories | lowercase kebab-case; plural for categories, singular for concepts | `specifications/component/` |
| Schema modules | `<concept>.schema.json` | `component.schema.json` |
| Bundle | `<family>.schema.json` — never a bare `schema.json` | `blueprint.schema.json` |
| Version directory | `v<MAJOR>` | `v1` |
| Source `$id` | `https://schemas.musher.dev/<family>/v<MAJOR>/<concept>` — extensionless, no trailing slash. Source modules are never served, so this is an identity, not a fetch URL. | `…/component/v1/component` |
| Bundle `$id` | The real publication URL, set by the bundler. Do not write it by hand. | `…/component/v1/component.schema.json` |
| `$defs` keys | UpperCamelCase, naming the concept. No `Seed` prefix, no `Request` suffix — those describe a platform pipeline, not a document contract. | `ComponentWorkload` |
| `title` | Module root only. Below the root, the key already names the field; use `description` to say what it means. | `Musher Component Document` |
| Conformance case | `<phase>-<NNN>-<description>` | `structural-001-missing-kind` |

## Prose vs schema

The JSON Schema `description` fields are **explanatory**. The definitive
behavioural rule always lives in `spec.md`, which uses RFC 2119 keywords and
stable HTML anchors that conformance fixtures link back to.

Diagnostic **codes** (`ERR_*`) and the phase at which validation fails are
normative. Human-readable error text is not — different language parsers emit
different strings and that is expected.

## Commits

Conventional Commits, scoped, DCO-signed:

```sh
git commit -s -m "feat(component): add restartPolicy"
```

Scope drives release-please. `feat(component):` cuts `component/v1.x.0`;
an unscoped `feat:` releases nothing.

## Known debt

The three schemas were seeded from the platform's Pydantic-generated catalog
schemas. Their `$defs` names still carry implementation affixes (`Seed…`,
`…Request`) and some auto-generated `title` values are mangled (`Specversion`).
Cleaning these is tracked as a v1 pre-stable task — do not treat the current
names as settled, and do not add new ones in that style.
