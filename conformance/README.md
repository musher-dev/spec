# Conformance Suite

A language-neutral corpus of test vectors. An implementation conforms to a
Musher specification family when it produces the declared outcome for every
case in that family's tree and in the core corpus
([core v1 §8](../specifications/core/v1/spec.md#conformance)). Each corpus lives
inside the family version it tests, at
`specifications/<family>/v<major>/conformance/`.

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

`tools/src/conformance/conformance.ts` is one such adapter. It exists to keep the fixtures
honest inside this repository and carries no special authority.

## Layout

```
specifications/<family>/v<major>/conformance/
  cases.json                   index of every case
  <phase>/<case-id>/
    metadata.json              declared outcome
    case.yaml                  the document under test, with no item root
    tree/                      …or the item it sits inside
    diagnostics.json           required when expected == "fail"
```

A case declares its subject as **exactly one** of `case.yaml` or `tree/`. See
[Case trees](#case-trees).

### <a id="core-corpus"></a>Core corpus

The [Musher Document Core Specification](../specifications/core/v1/spec.md) has
a corpus of its own, at `specifications/core/v1/conformance/`, whose `cases.json`
declares `"family": "core"`. It follows every rule on this page, and four more,
which [core v1 §8.1](../specifications/core/v1/spec.md#core-corpus) states:

- **Every core case is a `parser` case.** A `structural` case needs a schema,
  and core publishes none; a case about an item needs a document of some family
  inside a directory. A core case is therefore a `case.yaml`, never a `tree/`,
  and never declares `effective`.
- **An adapter runs a core case through its parser alone.** `expected: "pass"`
  means the parser accepts the document, and no later phase runs.
- **A core `case.yaml` asserts that there is no kind**, as every `case.yaml`
  asserts that there is no item root. Its document keeps an otherwise valid
  envelope, `kind: COMPONENT` included, but the value has no effect and an
  adapter MUST NOT dispatch on it.
- **A core case cites core only.** Its `clause` and every one of its
  `requirements` are declared in `specifications/core/v1/spec.md`.

The parser runs before a family is chosen, so an implementation covering
several families runs the core corpus once rather than once per family. Each
family corpus keeps one `parser` case, `parser-001-reject-duplicate-keys`, to
show that the family's pipeline applies the profile at all.

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
| `clause` | RECOMMENDED. Link to the normative clause the case exercises. Every case should trace to prose. Where the case also declares `requirements`, the two MUST be consistent: every specification declaring one of the requirements is the case's own family, core, or a normative dependency the family's §2 declares; `clause` cites the family's own `spec.md` or one of those declaring specifications; and where it cites a declaring specification, its anchor is the section holding the requirement's anchor or a section enclosing that one. A core case cites core only. |
| `requirements` | RECOMMENDED. Stable requirement IDs this case pins, e.g. `["CORE-ENV-002"]`. Each MUST resolve to an anchor in a `spec.md`. |
| `summary` | RECOMMENDED. One sentence, present tense. |
| `document` | REQUIRED for a tree case, forbidden otherwise. Path of the document under test, relative to `tree/`. |
| `symlinks` | OPTIONAL, tree cases only. Link path → link target, both verbatim. |
| `effective` | OPTIONAL, `expected: "pass"` only. Effective values this case pins, keyed by JSON Pointer. See [Effective values](#effective-values). |

### <a id="requirements"></a>Requirement IDs

`clause` names a section; a section states several rules. Thirteen cases cite
core's `#envelope`, which covers `specVersion`, `kind`, unknown fields, and an
unsupported version — so the citation says where to look and not what is being
pinned. `requirements` says which rule.

```json
{ "clause": "specifications/core/v1/spec.md#envelope",
  "requirements": ["CORE-ENV-002"] }
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
specifications/blueprint/v1/conformance/semantic/003-slug-disagrees-with-directory/
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
item root, which [core v1 §4.1](../specifications/core/v1/spec.md#item-directory)
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
| An `effective` value | Whether an implementation stores it or computes it on demand |

Different language parsers emit wildly different error text — `serde_yaml` and
`gopkg.in/yaml.v3` do not agree on a single string. Pinning codes and phases
instead of messages is what lets Go, Rust, Python, and TypeScript run the
identical corpus.

## <a id="effective-values"></a>Effective values

A case declares whether a document is **accepted**. That is not the whole of
what a document means, and [ADR 0008](../docs/adr/0008-effective-values.md) is
about the rest of it.

`default` in JSON Schema is an annotation. Validators do not insert it, so two
implementations can both accept the same document and still disagree about what
it says — one materialising `periodSeconds: 10` into its object model, one
leaving the field absent and reading the default when it needs to, and a third
treating an explicit `null` as different from an omission. All three pass an
acceptance fixture. Only one of them can be right about how often to poll.

`effective` is where the corpus says which:

```json
{
  "expected": "pass",
  "effective": {
    "/spec/workload/health/readiness/periodSeconds": 10,
    "/spec/workload/health/readiness/timeoutSeconds": 5
  }
}
```

The claim is about **behaviour, not representation**. An implementation MAY hold
the field as absent; what it MUST NOT do is behave differently from one holding
the value the map declares. Nothing here obliges anyone to rewrite a document.

A key is a JSON Pointer into the document under test. A pointer may name a field
the author wrote — pinning it asserts the corpus and the document agree — or one
they omitted, pinning what the contract supplies in its place. A pointer that
resolves to neither is an error in the fixture: an absent field with no default
has no effective value, and a case claiming otherwise is claiming something the
specification does not say.

`effective` is forbidden on a failing case. A rejected document has diagnostics,
not values.

## Phases

| Phase | Enforces | Network |
|---|---|---|
| `parser` | The Musher YAML profile — [core v1 §6.1](../specifications/core/v1/spec.md#yaml-profile) | Never |
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
  "coreEdition": "1.1.0",
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

`coreEdition` is the core edition the family release records, and names the
core corpus the claim covers alongside the family's own
([core v1 §8](../specifications/core/v1/spec.md#conformance)). It is the
recorded edition, not a later core v1 corpus the implementation may also have
run.

A result with `failed` greater than zero is not a conformance claim. A result
with `skipped` greater than zero is a claim only if every skipped case belongs
to a phase outside the declared profile.

## Coverage status

`parser`, `structural` and `semantic` are covered. Every diagnostic code the
`spec.md` files declare is exercised by at least one case, with four
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
runner's `UNCOVERED` list with a reason. A row of core's table counts as
exercised by a case in any corpus, because the core corpus is `parser`-only and
core's structural and item codes are fixtured by the families that apply them. A code goes untested only by someone
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
2. Create `<phase>/<NNN>-<description>/` under
   `specifications/<family>/v<major>/conformance/`, with `metadata.json`, and
   either a `case.yaml` or a `tree/` plus a `document` naming the file inside
   it.
3. For a failing case, add `diagnostics.json`.
4. Add the entry to that corpus's `cases.json`. A directory that is not indexed runs nowhere,
   and `task check:conformance` reports it rather than leaving it to be assumed
   green.
5. Run `task check:conformance`.

A case that does not cite a `clause` will be questioned in review. Fixtures
exist to pin down prose, not to freeze current implementation behaviour.

`task check:conformance` checks three separate things, and only the first needs
an implemented phase.

**Executing** a case runs the document through the pipeline and compares the
outcome. `tools/src/conformance/conformance.ts` implements `parser`, `structural` and
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
