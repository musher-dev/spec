# Conformance Suite

A language-neutral corpus of test vectors. An implementation conforms to a
Musher specification family when it produces the declared outcome for every
case in that family's tree.

**Where this sits.** A family's `spec.md` defines its complete behaviour. This
corpus is that prose's executable form for observable outcomes, as the JSON
Schema bundle is its executable form for structural validity; all three are
normative, and none is permitted to disagree with the others. A fixture that
contradicts the prose is a defect in this repository — it blocks a release, and
is never a licence to implement the fixture. What within a case is normative and
what is not is set out in [What is normative](#what-is-normative) below.

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
    case.yaml                  the document under test, with no item root
    tree/                      …or the item it sits inside
    diagnostics.json           required when expected == "fail"
```

A case declares its subject as **exactly one** of `case.yaml` or `tree/`. See
[Case trees](#case-trees).

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
| `requirements` | RECOMMENDED. Stable requirement IDs this case pins, e.g. `["COMP-ENV-002"]`. Each MUST resolve to an anchor in a `spec.md`. |
| `summary` | RECOMMENDED. One sentence, present tense. |
| `document` | REQUIRED for a tree case, forbidden otherwise. Path of the document under test, relative to `tree/`. |
| `symlinks` | OPTIONAL, tree cases only. Link path → link target, both verbatim. |

### <a id="requirements"></a>Requirement IDs

`clause` names a section; a section states several rules. Twenty-seven cases
cite `#envelope`, which covers `specVersion`, `kind`, unknown fields, and an
unsupported version — so the citation says where to look and not what is being
pinned. `requirements` says which rule.

```json
{ "clause": "specifications/component/v1/spec.md#envelope",
  "requirements": ["COMP-ENV-002"] }
```

An ID is `<FAMILY>-<SECTION>-<NNN>`, is declared beside the rule it names, and
is stable: renaming a heading moves the anchor a `clause` points at, and leaves
the ID alone.

**An ID names a rule a document can violate.** That is what makes the coverage
gate meaningful — every declared ID must be pinned by a case or recorded in the
runner's `UNPINNED` list with a reason, exactly as diagnostic codes are. Rules
about what an *implementation* does rather than what a document contains — that
a validator MUST NOT reach the network, MUST NOT echo a value in a diagnostic —
are normative prose and carry no ID, because an identifier whose permanent
state is "excused" documents nothing.

[`docs/traceability.md`](../docs/traceability.md) is generated from these and
shows every requirement against the clause stating it and the cases pinning it.

## <a id="case-trees"></a>Case trees

Some rules are about a document's *surroundings* rather than its contents: that
its slug matches the directory holding it, that a reference resolves to a file,
that a media path stays inside the item. A single `case.yaml` cannot state any
of them, so a case may instead carry a `tree/`:

```
conformance/blueprint/v1/semantic/003-slug-disagrees-with-directory/
  metadata.json      "document": "acme-wiki/blueprint.yaml"
  diagnostics.json
  tree/
    acme-wiki/                  <- the item root
      blueprint.yaml
      listing.yaml
      components/postgres.yaml
```

The **item root** is the directory containing `document`. `tree/` is its
parent, not the item root itself — `ERR_SLUG_MISMATCH` tests the item
directory's *name*, so the tree has to contain a directory that has one.

**`case.yaml` is not the legacy form.** It asserts that the document has **no**
item root, which [blueprint §3.1](../specifications/blueprint/v1/spec.md#item-directory)
makes a real state: a document submitted over an API arrives without a
directory, and an implementation in that position MUST NOT report any rule
measured against one. An adapter that invents an item root for a `case.yaml` is
wrong.

**Symlinks are declared, not committed.** `ERR_PATH_ESCAPE` needs a link
resolving outside the item, and a committed one does not survive a checkout
without `core.symlinks`, is invisible in a diff, and would ship inside a release
tarball pointing outside the archive. `metadata.symlinks` names them instead:

```json
{ "symlinks": { "acme-wiki/media/icon.png": "../../../secrets.png" } }
```

An adapter copies `tree/` somewhere writable, creates the links there, and runs
against the copy. The target need not exist — a dangling link resolving outside
the item root is still an escape, because containment is a property of the
resolved location rather than of the string.

**Media files in a tree are zero bytes.** The rules they exercise are existence
and containment; nothing decodes them. A real image would make the fixture
larger without making it say more, and would invite a reader to think the
dimensions mattered — [listing §5](../specifications/listing/v1/spec.md#media)
records that they do not.

An adapter that cannot materialise a tree SKIPs those cases. It MUST NOT report
them as passed.

The contract is set by
[ADR 0002](../docs/adr/0002-conformance-case-trees.md).

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

## <a id="what-is-normative"></a>What is normative

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
| `parser` | The Musher YAML profile — [component §7.1](../specifications/component/v1/spec.md#yaml-profile) | Never |
| `structural` | The family's JSON Schema 2020-12 bundle | Never |
| `semantic` | Reference resolution, path containment, cross-document agreement | Never |
| `capability` | Account, region, and quota checks | Server only |

An implementation MUST apply the phases in order and MUST NOT report a
later-phase diagnostic before the earlier phases pass.

## <a id="profiles"></a>Profiles

Not every implementation runs every phase, and that is by design: `capability`
needs an account, a region, and a quota, which is a server. An editor plugin
that checks structure is a useful thing to be, and it is not the same thing as a
control plane.

So "Musher conformant" is not a claim anyone can make on its own. An
implementation claims a **profile**, and each profile names the phases it must
pass every case in:

| Profile | Required phases | Typical implementation |
|---|---|---|
| `parser` | `parser` | A linter or formatter that reads documents but does not validate them |
| `structural` | `parser`, `structural` | An editor integration binding the published schema |
| `offline` | `parser`, `structural`, `semantic` | A CLI validating a working tree, with no network |
| `platform` | all four | A control plane accepting submissions |

The profiles are cumulative: `offline` includes everything `structural`
requires. An implementation MUST NOT claim a profile while skipping any case in
a phase that profile requires — a skipped case is never a passed one
([above](#case-trees)).

`offline` is the highest profile reachable without a network, and it is
deliberately a named stopping point rather than a shortfall. No phase below
`capability` may reach the network, so an implementation running everything a
client is permitted to run is `offline`-conformant and complete.

### Reporting a result

An implementation publishing a conformance result SHOULD publish it in this
shape, so that two claims can be compared:

```json
{
  "implementation": "musher-cli",
  "implementationVersion": "1.4.0",
  "family": "component",
  "specificationRelease": "1.2.0",
  "suiteCommit": "af2dec0…",
  "profile": "offline",
  "passed": 184,
  "failed": 0,
  "skipped": 4
}
```

`suiteCommit` matters as much as `specificationRelease`: a case may be added to
the corpus between releases, so "which cases were run" is not answered by a
version number alone.

A result with `failed` greater than zero is not a conformance claim. A result
with `skipped` greater than zero is a claim only if every skipped case belongs
to a phase outside the declared profile.

## Coverage status

`parser`, `structural` and `semantic` are covered. Every diagnostic code the
three `spec.md` files declare is exercised by at least one case, with four
exceptions, all `capability`:

| Code | Why it has no case |
|---|---|
| `ERR_UNKNOWN_COMPONENT` | `capability` — resolving a published reference needs the catalog, and no phase a client runs may reach the network |
| `ERR_VERSION_NOT_MONOTONIC` | `capability` — comparing a version against the lineage it extends needs the catalog, and a fixture is one document with no previous release to be greater than |
| `ERR_COMPONENT_NOT_PUBLISHED` | `capability` — only the registry holds publication state, and a fixture is a tree of files none of which has one |
| `ERR_UNKNOWN_COMPUTE_PROFILE` | `capability` — the slug grammar is fixtured, but which profiles are offered changes when the platform gains hardware to back a tier, not when this repository releases |

That table is not prose anyone has to remember to update.
`task check:conformance` derives it: every `ERR_*` row in a family's own
diagnostics table must be exercised by an indexed case or appear in the
runner's `UNCOVERED` list with a reason. A code goes untested only by someone
writing down why, in a diff a reviewer sees.

The check runs in both directions, and the second one is the reason for the
first. Before it existed, ten codes reached `main` with no fixture and CI
green — the corpus could only tell you that the cases it had were right, never
that it had the cases it needed.

An adapter encountering a phase it does not implement, or a case shape it does
not support, SHOULD skip the case and report it as skipped. It MUST NOT report
it as passed.

## Adding a case

1. Pick the phase and the next free sequence number in that phase.
2. Create `<phase>/<NNN>-<description>/` with `metadata.json`, and either a
   `case.yaml` or a `tree/` plus a `document` naming the file inside it.
3. For a failing case, add `diagnostics.json`.
4. Add the entry to `cases.json`. A directory that is not indexed runs nowhere,
   and `task check:conformance` reports it rather than leaving it to be assumed
   green.
5. Run `task check:conformance`.

A case that does not cite a `clause` will be questioned in review. Fixtures
exist to pin down prose, not to freeze current implementation behaviour.

`task check:conformance` checks three separate things, and only the first needs
an implemented phase.

**Executing** a case runs the document through the pipeline and compares the
outcome. `tools/src/conformance.ts` implements `parser`, `structural` and
`semantic`; a `capability` case is skipped.

**Validating** a case runs whether or not its phase does: the `id` leads with
its phase, `cases.json` and `metadata.json` agree on that phase, the case
declares exactly one of `case.yaml` or `tree/`, the `clause` resolves to an
anchor that exists in the cited `spec.md`, and every declared `code` appears in
a diagnostics table reachable from the family's own — at the phase that table
assigns it.

**Auditing** the corpus asks the questions no individual case can: does every
declared diagnostic code have a fixture, and does every case directory on disk
appear in `cases.json`.
