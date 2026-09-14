# Using the schemas

Every [kind family](../specifications/README.md#kind-family) publishes one
JSON Schema (draft 2020-12) bundle per major version, and one per exact release.
This page is for anyone validating Musher documents: in an editor, in
automation, or offline. Core publishes no schema, for the reason
[How the families relate](../specifications/README.md#how-the-families-relate)
gives.

## <a id="which-url"></a>Which URL

| Name | URL | Serves | Changes? | Use for |
|---|---|---|---|---|
| Major-version alias | `https://specifications.musher.dev/<family>/v<MAJOR>/<family>.schema.json` | The newest release in the major, or a build of `main` before the major's first release | Yes, on every release | Editors and people |
| Exact release | `https://specifications.musher.dev/<family>/v<MAJOR>.<MINOR>.<PATCH>/<family>.schema.json` | Exactly one release | Never | CI, automation, and audit |

Each bundle's `$id` is the URL it is served at. Each exact release URL has a
`.sha256` file beside it, and `/<family>/versions.json` lists every release of a
family.

**Exact release URLs exist only after a family's first release.** Until then
there is nothing immutable to pin, and whether a version has been released is
explained in [Draft or released](publication.md#draft-or-released).

## <a id="in-your-editor"></a>In your editor

Add a modeline to the top of a document, naming its family's alias:

```yaml
# yaml-language-server: $schema=https://specifications.musher.dev/<family>/v1/<family>.schema.json
```

| Family | Modeline |
|---|---|
| component | `# yaml-language-server: $schema=https://specifications.musher.dev/component/v1/component.schema.json` |
| blueprint | `# yaml-language-server: $schema=https://specifications.musher.dev/blueprint/v1/blueprint.schema.json` |
| listing | `# yaml-language-server: $schema=https://specifications.musher.dev/listing/v1/listing.schema.json` |

Or bind by file name in VS Code's `settings.json`, with the Red Hat YAML
extension. These are the same patterns the catalog below publishes:

```json
{
  "yaml.schemas": {
    "https://specifications.musher.dev/component/v1/component.schema.json": [
      "**/components/*.yaml",
      "**/components/*.yml",
      "**/component.yaml",
      "**/component.yml",
      "**/component-*.yaml",
      "**/component-*.yml"
    ],
    "https://specifications.musher.dev/blueprint/v1/blueprint.schema.json": [
      "**/blueprint.yaml",
      "**/blueprint.yml"
    ],
    "https://specifications.musher.dev/listing/v1/listing.schema.json": [
      "**/listing.yaml",
      "**/listing.yml"
    ]
  }
}
```

A tool that reads SchemaStore-format catalogs can discover all of this from
`https://specifications.musher.dev/catalog.json`, which binds each family's
file patterns to its major-version alias.

## <a id="pinning"></a>Pinning in automation

Automation MUST pin an exact release URL. A major-version alias exists so an
editor picks up backward-compatible additions without a configuration change,
which is exactly what makes it the wrong target for a build: the bytes behind it
change when a release ships. An exact release URL serves the same bytes for as
long as the site exists.

Before a family's first release, automation has no exact URL to pin, and the
alias moves with every push to `main`. Pin a commit of this repository instead,
and build the bundle from it:

```sh
git -C specifications checkout <commit>
bun specifications/tools/src/schema/bundle.ts --stdout <family>/v1 > <family>.schema.json
```

The bundler needs no `bun install`
([tools/README.md → Bundler CLI](../tools/README.md#bundler-cli)). Switch to the
exact release URL once the family releases.

## <a id="offline"></a>Offline and vendoring

Every bundle is self-contained: every `$ref` resolves inside its own `$defs`,
so no validator ever makes a network request to evaluate a document.

To vendor a release, download its assets from
[GitHub Releases](https://github.com/musher-dev/specifications/releases). What
each release attaches, and what its archive holds, is listed in
[Publication → Release assets](publication.md#release-assets). The bundle in a
release is byte-for-byte what its exact release URL serves.

To inspect the schema a checkout would publish, run `task bundle`, which writes
it under `dist/`.

## <a id="verifying"></a>Verifying what you downloaded

Checksums, provenance attestations, and the ledger of every release's hash are
covered, with commands, in
[Verifying a release](../.github/SECURITY.md#verifying-a-release).

## <a id="headers"></a>Headers you will see

Every path is served with open CORS, so a browser-based validator can fetch a
schema directly. An exact release is cached as immutable, and an alias is
revalidated within five minutes of a release. The full table is in
[Publication → Cache policy](publication.md#cache-policy).

## <a id="moved-host"></a>Moved host

These schemas were first served from `schemas.musher.dev`. That host is being
retired: once the redirect is in place, it answers with a `301` to the same path
on `specifications.musher.dev`. Every `$id` names the new host, and nothing was
ever released under the old one, so no exact release URL moves. Point
automation, and every modeline and binding, at `specifications.musher.dev` now
rather than relying on the redirect. The redirect is not live yet, and not
every validator follows one.
