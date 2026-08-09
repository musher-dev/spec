# Conformance Suite

A language-neutral corpus of test vectors. An implementation conforms to a
Musher specification family when it produces the declared outcome for every
case in that family's tree.

There is deliberately **no normative runner**. A reference implementation
becomes the de facto standard, hides normative behaviour inside compiled code,
and biases the specification toward one language's standard library. Each
implementation writes its own thin adapter over this data instead. That is what
makes cross-language parity provable rather than asserted.

`tools/src/conformance.ts` is one such adapter. It exists to keep the fixtures
honest inside this repository and carries no special authority.

## Layout

```
conformance/<family>/v<major>/
  cases.json                   index of every case
  <phase>/<case-id>/
    metadata.json              declared outcome
    case.yaml                  the document under test
    diagnostics.json           required when expected == "fail"
```

## `cases.json`

```json
{
  "family": "component",
  "specVersion": "v1",
  "cases": [
    { "id": "structural-001-missing-kind", "phase": "structural", "path": "structural/001-missing-kind" }
  ]
}
```

An adapter reads this index rather than walking the filesystem, so adding a
directory without indexing it is a no-op — index entries are the contract.

## `metadata.json`

```json
{
  "id": "structural-001-missing-kind",
  "phase": "structural",
  "expected": "fail",
  "clause": "specifications/component/v1/spec.md#envelope",
  "summary": "A document omitting the kind discriminator is rejected."
}
```

| Field | Requirement |
|---|---|
| `id` | REQUIRED. MUST equal the `cases.json` entry and follow `<phase>-<NNN>-<description>`. |
| `phase` | REQUIRED. One of `parser`, `structural`, `semantic`, `capability`. |
| `expected` | REQUIRED. `pass` or `fail`. |
| `clause` | RECOMMENDED. Link to the normative clause the case exercises. Every case should trace to prose. |
| `summary` | RECOMMENDED. One sentence, present tense. |

## `diagnostics.json`

Required when `expected` is `fail`. A non-empty array:

```json
[{ "code": "ERR_MISSING_FIELD", "path": "" }]
```

`path` is a JSON Pointer into the document; `""` is the root.

An implementation passes a failing case when it rejects the document **in the
declared phase** and produces **at least** the declared diagnostics. Producing
additional diagnostics is permitted — a validator reporting every problem at
once is more useful than one that stops at the first.

## What is normative

| Normative | Not normative |
|---|---|
| The diagnostic `code` | The human-readable message |
| The `path` the diagnostic anchors to | The order diagnostics are emitted |
| The `phase` at which validation fails | Whether extra diagnostics accompany the declared ones |

Different language parsers emit wildly different error text — `serde_yaml` and
`gopkg.in/yaml.v3` do not agree on a single string. Pinning codes and phases
instead of messages is what lets Go, Rust, Python, and TypeScript run the
identical corpus.

## Phases

| Phase | Enforces | Network |
|---|---|---|
| `parser` | Strict YAML 1.2 — duplicate keys and aliases rejected | Never |
| `structural` | The family's JSON Schema 2020-12 bundle | Never |
| `semantic` | Reference resolution, path containment, dependency cycles | Never |
| `capability` | Account, region, and quota checks | Server only |

An implementation MUST apply the phases in order and MUST NOT report a
later-phase diagnostic before the earlier phases pass.

## Coverage status

`parser` and `structural` are covered. `semantic` is covered for every rule a
single document can express — a floating image tag, a probe naming an endpoint
that is not there, a connection naming a node that is not there, a cyclic
graph, two screenshots sharing a basename. `capability` has no cases.

The gap is not which rules are written down; it is what a case can say. Every
remaining `semantic` rule is about a document's surroundings rather than its
contents:

| Rule | Needs |
|---|---|
| `ERR_SLUG_MISMATCH` | a directory with a name |
| `ERR_VERSION_MISMATCH` | a sibling document |
| `ERR_UNREFERENCED_COMPONENT` | the item's other files |
| `ERR_COMPONENT_NOT_FOUND`, `ERR_REFERENCE_ESCAPE` | a resolvable target |
| `ERR_UNKNOWN_OUTPUT` | the referenced component document |
| `ERR_MEDIA_NOT_FOUND`, `ERR_PATH_ESCAPE` | a file on disk |

A case is one `case.yaml`, so none of those is expressible. Extending the
fixture contract to a case tree is an ADR-gated change — GOVERNANCE.md lists
"Changing the conformance fixture contract" among the changes needing one —
and those cases land against that ADR rather than being approximated in the
meantime.

An adapter encountering a phase it does not implement SHOULD skip the case and
report it as skipped. It MUST NOT report it as passed.

## Adding a case

1. Pick the phase and the next free sequence number in that phase.
2. Create `<phase>/<NNN>-<description>/` with `metadata.json` and `case.yaml`.
3. For a failing case, add `diagnostics.json`.
4. Add the entry to `cases.json`.
5. Run `task check:conformance`.

A case that does not cite a `clause` will be questioned in review. Fixtures
exist to pin down prose, not to freeze current implementation behaviour.

`task check:conformance` checks two separate things, and only the first of them
needs an implemented phase. Whether or not a case can be *executed* here, its
metadata is validated: the `id` leads with its phase, `cases.json` and
`metadata.json` agree on that phase, the `clause` resolves to an anchor that
exists in the cited `spec.md`, and every declared `code` appears in a
diagnostics table reachable from the family's own — at the phase that table
assigns it. A `semantic` fixture is skipped for execution but not for this.
