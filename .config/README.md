# `.config/` — Tool Configuration

Every linter, formatter, and hook config lives here. One directory, one
purpose: if a tool needs a config file and it is not provisioning the
container, it goes in here.

Policy and rationale:
[`docs/adr/0011-tooling-configuration-layout.md`](../docs/adr/0011-tooling-configuration-layout.md).
Enforcement: `task check:config` (CFG-01..CFG-08, and CFG-09 for the repository root), implemented in
[`tools/src/policy/config.ts`](../tools/src/policy/config.ts).

The convention is shared with `musher-dev/development-container` and
`musher-dev/platform`. Keeping the three aligned is the point: a contributor
moving between them should not have to re-learn where the linter configs are.

## Index

Every file, the tool that reads it, and how that tool is pointed at it. A file
missing from this table fails CFG-03; a file no caller names fails CFG-04.

| File | Tool | How it is reached |
| --- | --- | --- |
| `lefthook.yml` | lefthook | **Auto-discovered.** Lefthook searches `.config/lefthook.*` natively |
| `lefthook-local.yml` | lefthook | Auto-discovered and merged. Gitignored; personal overrides only |
| `actions/actionlint.yaml` | actionlint | `-config-file .config/actions/actionlint.yaml` |
| `markdown/markdownlint.jsonc` | markdownlint-cli2 | `--config .config/markdown/markdownlint.jsonc` |
| `spelling/cspell.json` | cspell | `--config .config/spelling/cspell.json` |
| `spelling/musher.txt` | cspell | Resolved via `dictionaryDefinitions[].path` in `spelling/cspell.json` |

Call sites are [`Taskfile.yml`](../Taskfile.yml), [`taskfiles/`](../taskfiles/),
`.config/lefthook.yml`, and [`.github/workflows/`](../.github/workflows/).
Tool versions are pinned in
[`tools/package.json`](../tools/package.json) for anything installed by Bun,
and in [`.devcontainer/mise.toml`](../.devcontainer/mise.toml) for the rest.
CI is not a mise host and does not read that file. The CI workflows pin the
tools they install themselves, Task and actionlint, to the same versions.
ShellCheck is the exception: CI uses the copy preinstalled on the runner image,
which is not pinned and can differ from the container's.

## Rules

1. **Bucket by concern.** `.config/<concern>/<tool>.<ext>`. A one-file bucket
   is fine and collects siblings over time. The single exception is
   `lefthook.yml`, which sits at the top level because lefthook's config search
   does not descend past `.config/lefthook.*` — bucketing it would silently
   stop every hook.
2. **No leading dot on filenames.** The directory is already dotted; a second
   dot advertises a discovery mechanism that is deliberately not in use.
3. **Pass the path explicitly.** Except for lefthook, which finds this
   directory on its own, every caller names its config with the tool's own
   config flag. Never rely on default discovery — that is what put these files
   at the repo root in the first place.
4. **Every file must have a caller.** A config nothing reads is dead weight
   that still reads as authoritative.
5. **Every ignore needs a reason.** Suppressions, allowlists, and disabled
   rules carry an inline comment explaining why the exception is acceptable.
6. **Configuration only.** No executables. A build asset belongs beside what
   builds it; a repo-level runner belongs in `tools/src/`.

Adding a config? Verify the flag is live: point the tool at a path that does not exist
and confirm it fails. A silently-ignored `--config` is the failure mode this
whole directory exists to prevent, and it is one command to rule out.

## What does *not* live here

| Thing | Where | Why |
| --- | --- | --- |
| `Taskfile.yml` | Repo root | Task only discovers `Taskfile.*` at the root; `--taskfile` would break bare `task <name>` |
| `.gitignore`, `.gitattributes` | Repo root | Git reads these from the root only |
| `.claude/CLAUDE.md` | `.claude/` | Claude Code reads project instructions there. An agent brief, not tool configuration; editor whitespace lives in `devcontainer.json` (docs/adr/0024) |
| `LICENSE`, `NOTICE` | Repo root | GitHub detects a licence at the root only, and Apache-2.0 expects NOTICE to travel with the work |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` | `.github/` | Community health files, which GitHub resolves from there |
| `biome.json`, `tsconfig.json` | `tools/` | They belong to the `tools/` package and are resolved by it — a package's own config, not a repo-level one |
| `published.json` | Repo root | A published data artifact, not tool configuration. The catalog is build output under `dist/`, never tracked |
| `mise.toml`, `devcontainer.json` | `.devcontainer/` | They provision the environment rather than checking the code |
| `dependabot.yml`, `release-please/`, `rulesets/`, `workflows/` | `.github/` | GitHub reads these from fixed locations |

## Deliberately config-less

**shellcheck.** Its threshold is passed at the call site because `.shellcheckrc`
supports no `severity` key — the rcfile accepts only `disable`, `enable`,
`external-sources`, `source`, `source-path` and `shell`, and an unrecognised
key is silently ignored rather than rejected. A `.config/shell/shellcheckrc`
holding `severity=warning` would look like a gate and enforce nothing. If
shellcheck ever gains the key, the file becomes worth adding.

## A trap worth knowing

Lefthook's config search is **first-match-wins**, in this order:

```text
lefthook.*  →  .lefthook.*  →  .config/lefthook.*
```

A stray `lefthook.yml` at the repo root therefore **silently shadows** this
directory's copy — no warning, no error, just a different set of hooks.
`task check:config` (CFG-06) fails the build if one appears.
