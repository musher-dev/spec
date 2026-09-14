# Musher Document Specifications

This repository defines the formats of the documents people write for
[Musher](https://musher.dev), and the rules for interpreting them: normative
prose, the JSON Schemas built from it, example documents, and language-neutral
conformance corpora. The platform API and Musher's internal data models are
specified elsewhere. An implementation that disagrees with what is published
here is defective.

**Status:** pre-stable. Whether a version is released:
[Draft or released](docs/publication.md#draft-or-released).

## Specifications

| Family | Specification | Front page | Rendered prose |
|---|---|---|---|
| core | [`core/v1/spec.md`](specifications/core/v1/spec.md) | [README](specifications/core/README.md) | [core v1](https://specifications.musher.dev/reference/core/v1/spec/) |
| component | [`component/v1/spec.md`](specifications/component/v1/spec.md) | [README](specifications/component/README.md) | [component v1](https://specifications.musher.dev/reference/component/v1/spec/) |
| blueprint | [`blueprint/v1/spec.md`](specifications/blueprint/v1/spec.md) | [README](specifications/blueprint/README.md) | [blueprint v1](https://specifications.musher.dev/reference/blueprint/v1/spec/) |
| listing | [`listing/v1/spec.md`](specifications/listing/v1/spec.md) | [README](specifications/listing/README.md) | [listing v1](https://specifications.musher.dev/reference/listing/v1/spec/) |

The rendered prose is generated and informative, and is live once the site's
first deploy has run. What each family describes and how they depend on one
another is set out in [specifications/README.md](specifications/README.md), and
which of its parts are normative in
[What is normative](specifications/README.md#what-is-normative).

## I want to…

| I want to… | Start at |
|---|---|
| validate a document, or bind a schema in my editor | [Using the schemas](docs/using-schemas.md) |
| implement a parser or validator | [Implementing a family](specifications/README.md#implementing), then the [fixture format](conformance/README.md) |
| look up a rule by its requirement ID | [Requirement traceability](docs/traceability.md) |
| know whether a version is released | [Draft or released](docs/publication.md#draft-or-released) |
| know what counts as a breaking change | [Compatibility review](GOVERNANCE.md#compatibility-review) |
| change a specification | [Contributing](.github/CONTRIBUTING.md) |
| understand why something was decided | [Architecture decision records](docs/adr/README.md) |
| report a vulnerability | [Security policy](.github/SECURITY.md) |
| see every guide, by audience | [Documentation index](docs/README.md) |

## Repository map

```
specifications/   one directory per family; each major version, v<N>/, releases on its own tag line
conformance/      the fixture format every corpus follows
docs/             guides, conventions, traceability, and decision records
tools/            non-normative build and check scripts (Bun and TypeScript)
taskfiles/        the tasks behind `task check`
.config/          every linter, formatter, and hook configuration
.github/          contributing, security, rulesets, and workflows
published.json    append-only ledger of every release (docs/publication.md#the-ledger)
```

## Contributing

```sh
task setup   # install tooling and git hooks
task check   # run every check CI runs, except the CI-only steps
```

Read [CONTRIBUTING.md](.github/CONTRIBUTING.md) before opening a pull request,
[docs/conventions.md](docs/conventions.md) for how repository artifacts are
named, and [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made.

## License

[Apache-2.0](LICENSE). See also [NOTICE](NOTICE).
