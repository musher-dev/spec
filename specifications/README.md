# Specifications

Each directory here is one **family**: an independently versioned specification
of one kind of Musher document, or, for `core`, of the rules every kind shares.

## <a id="families"></a>Families

| Family | `kind` | Requirement IDs | Describes | Front page |
|---|---|---|---|---|
| [core](core/v1/spec.md) | none: the base every family applies | `CORE-*` | The rules every Musher document shares: the envelope, version compatibility, the catalog item, the YAML profile, validation layers, and shared diagnostics. | [README](core/README.md) |
| [component](component/v1/spec.md) | `COMPONENT` | `COMP-*` | A workload Musher runs, or an external service, plus the configuration contract it exposes. | [README](component/README.md) |
| [blueprint](blueprint/v1/spec.md) | `BLUEPRINT` | `BP-*` | A composition of components into one deployable application. | [README](blueprint/README.md) |
| [listing](listing/v1/spec.md) | `LISTING` | `LIST-*` | The catalog storefront entry for a blueprint or component item. | [README](listing/README.md) |

Families version independently. Each major version is a directory, `v<MAJOR>`,
and the exact releases within it are git tags of the form
`<family>/v<MAJOR>.<MINOR>.<PATCH>`.

## <a id="how-the-families-relate"></a>How the families relate

```
core ◄── component ◄── blueprint
  ▲
  └───── listing
```

- **Core defines no kind.** No document declares it and none is validated
  against it alone. Every other family applies it and binds the parameters it
  leaves open ([core v1 §1.1](core/v1/spec.md#bindings)).
- **Blueprint applies component** as well as core: a blueprint composes
  component documents, and reaches component's value shapes through that
  declared dependency.
- **Listing applies core only.** It presents an item without influencing how
  anything in it runs.
- **All of them share core's item directory**
  ([core v1 §4.1](core/v1/spec.md#item-directory)): a catalog item is one
  directory, whose `blueprint.yaml` and `listing.yaml` are its item documents
  and whose component documents sit inside it.

Each family names what it applies in the "Normative dependencies" table of its
own §2, and that table, not this diagram, is authoritative.

## <a id="anatomy"></a>Anatomy of a family version

```
specifications/<family>/
  README.md             the family's front page; outside every release
  v<MAJOR>/             one release-please package: one release train
    spec.md             normative prose
    schemas/src/        authored JSON Schema modules (kind families only)
    examples/           example documents, validated in CI (kind families only)
    conformance/        the corpus, in the format conformance/README.md defines
    CHANGELOG.md        written by release-please, from the first release on
```

Everything under `v<MAJOR>/` belongs to that family version, fixtures included,
so a releasable commit touching it enters that family's next release
([Commit messages](../.github/CONTRIBUTING.md#commit-messages)).

Build output is not in git. `task bundle` compiles `schemas/src/` into a
self-contained bundle under `dist/`, and every check builds it in memory.

## <a id="what-is-normative"></a>What is normative

Core's `spec.md` defines the behaviour every family shares. A kind family's
`spec.md`, read together with the core specification it applies, defines that
family's complete behaviour. Each has executable forms:

- **The JSON Schema bundle** built from a kind family's `schemas/src/` is the
  executable form of that family's structural validity, and states core's
  envelope rules for that family's documents. Core publishes no schema.
- **The conformance corpus** is the executable form for observable outcomes. A
  family release is covered by its own corpus together with the core corpus.

The prose, the bundle, and the corpora are normative, and none is permitted to
disagree with another. A disagreement between two of them is a defect in the
specification and blocks a release. Until it is fixed the prose governs, but
that is how to read a broken contract, not a licence for a schema or a fixture
to be wrong.

Diagnostic codes (`ERR_*`) and the phase at which validation fails are
normative. Schema `description` fields, examples, generated documentation (the
reference on the site and [docs/traceability.md](../docs/traceability.md)
included), and human-readable validator messages are informative.

What within a single conformance case is normative is set out in
[conformance/README.md](../conformance/README.md#what-is-normative).

## <a id="implementing"></a>Implementing a family

1. **Read core first**, then the family. Core's
   [§6 Validation layers](core/v1/spec.md#validation-layers),
   [§7 Diagnostics](core/v1/spec.md#diagnostics) and
   [§8 Conformance](core/v1/spec.md#conformance) apply to every family. A
   family's diagnostic registry is its own table plus core's plus those of the
   families it declares as dependencies, so a blueprint implementation reads
   component too.
2. **Run two corpora**: the family version's `conformance/`, and core's at the
   edition the family release records
   ([core v1 §9](core/v1/spec.md#editions)). Core cases run through the parser
   alone. Declare the profile you claim, as
   [conformance/README.md](../conformance/README.md#profiles) describes.
3. **Trace what you cover.** [docs/traceability.md](../docs/traceability.md)
   maps every requirement ID to the clause stating it and the cases pinning it.

## <a id="draft-or-released-pointer"></a>Draft or released

Nothing in this directory records whether a version has been released: a
`spec.md` on `main` is always the draft of its major's next release. What makes
a version released, and how to tell, is in
[Draft or released](../docs/publication.md#draft-or-released).
