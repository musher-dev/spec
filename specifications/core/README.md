# Core specification

The Musher Document Core Specification states the rules every Musher document
family shares: the document envelope, version compatibility, the catalog item,
the identifier grammars more than one family uses, the validation layers and
the YAML profile, the shared diagnostic codes, and what a conformance claim
covers.

Core **defines no kind**. No file is a core document, and no document is
validated against core alone: each family applies it and binds the parameters it
leaves open ([§1.1](v1/spec.md#bindings)). For the same reason core **ships no
schema**. Its rules reach a document through each family's bundle, and its own
executable form is a parser-phase conformance corpus.

## Versions

| Major | Specification | Corpus | Released? |
|---|---|---|---|
| `v1` | [`v1/spec.md`](v1/spec.md) | [`v1/conformance/`](v1/conformance/) | [Draft or released](../../docs/publication.md#draft-or-released) |

Core has its own release line, tagged `core/v<MAJOR>.<MINOR>.<PATCH>`. Each
family release records the core edition it was built and tested against
([§9](v1/spec.md#editions)).

## Read in this order

1. [§1 Scope](v1/spec.md#scope) and [§1.1 Bindings](v1/spec.md#bindings)
2. [§2 Document envelope](v1/spec.md#envelope)
3. [§4 Items](v1/spec.md#items)
4. [§6 Validation layers](v1/spec.md#validation-layers), including
   [§6.1 The Musher YAML profile](v1/spec.md#yaml-profile)
5. [§7 Diagnostics](v1/spec.md#diagnostics) and
   [§8 Conformance](v1/spec.md#conformance)

## Builds on

Nothing. Core is the base: [component](../component/README.md),
[blueprint](../blueprint/README.md) and [listing](../listing/README.md) each
apply core v1 and say so in their own §2.

## Requirement IDs

| Prefix | Covers | Section |
|---|---|---|
| `CORE-ENV` | The document envelope | [§2](v1/spec.md#envelope) |
| `CORE-ITEM` | Item identity | [§4.2](v1/spec.md#item-identity) |
| `CORE-YAML` | The Musher YAML profile | [§6.1](v1/spec.md#yaml-profile) |

Every ID, the clause stating it, and the cases pinning it:
[core/v1 in docs/traceability.md](../../docs/traceability.md#corev1).
