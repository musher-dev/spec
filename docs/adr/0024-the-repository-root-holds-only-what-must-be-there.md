# ADR 0024: The repository root holds only what must be there

- **Status:** Accepted
- **Date:** 2026-09-14
- **Supersedes:** [ADR 0011](0011-tooling-configuration-layout.md) §6, `.editorconfig` as the statement of editor whitespace
- **Refines:** [ADR 0011](0011-tooling-configuration-layout.md), what may sit at the repository root
- **Refines:** [ADR 0021](0021-repository-organized-around-the-family-version.md) §2, the fixture format's path
- **Relies on:** [ADR 0023](0023-published-bytes-are-immutable-release-assets.md) §6, its archive member

## Context

After [ADR 0021](0021-repository-organized-around-the-family-version.md) the
root still held four entries that were there by habit rather than necessity:

- `CLAUDE.md`, the brief for coding agents. Claude Code reads project
  instructions from `.claude/CLAUDE.md` as readily as from the root.
- `GOVERNANCE.md`. GitHub treats `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md` and `SUPPORT.md` as community health files, found in
  `.github/`, the root or `docs/`. It does not recognize `GOVERNANCE.md`
  anywhere, so the root gave it nothing a link does not.
- `.editorconfig`, which
  [ADR 0011](0011-tooling-configuration-layout.md) §6 kept as the one statement
  of editor whitespace, for contributors who work outside the dev container.
- `conformance/`, which ADR 0021 §2 emptied of every corpus and left holding
  one README. To a newcomer it reads as a directory someone forgot to delete.

Nothing distinguished these from the entries that cannot move. That is the
problem ADR 0011 described for tool configs, one level up: the root grows one
entry at a time, and nothing asks why.

The sibling repositories have settled the same questions since ADR 0011.
`musher-dev/observability-schema-registry`, the closest analogue to this one,
keeps `.claude/CLAUDE.md` and `docs/governance.md`, states editor whitespace in
`devcontainer.json` with no `.editorconfig`, and keeps its ledger, `Taskfile.yml`
and `taskfiles/` at the root. `musher-dev/development-container`, `company` and
`foundation-bootstrap` state editor whitespace in `devcontainer.json` too. This
repository had become the outlier.

No release has been tagged. None of these moves changes a published identifier
or a release archive member, so they would be possible later, but they are
cheapest now.

## Decision

### 1. The root is an allowlist

The repository root holds exactly these entries.

| Entry | Why it is at the root |
|---|---|
| `README.md` | GitHub renders it as the repository's front page |
| `LICENSE`, `NOTICE` | GitHub detects a licence only at the root, and Apache-2.0 expects `NOTICE` to travel with the work |
| `Taskfile.yml` | Task discovers it only at the root |
| `.gitignore`, `.gitattributes` | Git reads them from the root |
| `published.json` | The ledger ([ADR 0006](0006-publication-from-tags.md) §3), a published data artifact rather than configuration |
| `specifications/`, `docs/`, `tools/`, `taskfiles/` | Content a contributor edits |
| `.claude/`, `.config/`, `.devcontainer/`, `.github/` | Machinery that operates on that content |

Visible entries are content, or a file some tool or GitHub reads only from the
root. Dotted entries are machinery. `ROOT_ENTRIES` in `tools/src/lib/layout.ts`
holds the list, and `task check:config` fails with CFG-09 on any other top-level
entry git tracks. Untracked files do not count: a checkout also holds what runs
in it, such as the linter CI downloads before it lints, or local build output.
Adding an entry is a change to `ROOT_ENTRIES`, and the pull request making it
says why the entry cannot live anywhere else.

### 2. Editor intent is stated once, in `devcontainer.json`

`.editorconfig` is deleted, and the EditorConfig extension with it.
`devcontainer.json`, under `customizations.vscode.settings`, states indentation,
line endings, encoding, trailing whitespace and the final newline, with a
Markdown override that keeps trailing spaces, since two of them are a hard line
break.

This reverses the direction of ADR 0011 §6 and keeps its principle: one
statement, never two. §6 chose `.editorconfig` because it reaches editors outside
the container. What those contributors lose is a hint, not a gate.
`.gitattributes` still normalizes line endings to LF in git, markdownlint still
fails trailing spaces and a missing final newline in prose, and Biome still
formats `tools/`. One convention across every Musher repository with a dev
container is worth more than a hint that only some editors honour.

### 3. The agent brief lives at `.claude/CLAUDE.md`

The brief moves beside the rest of the agent machinery and is committed.
`.claude/worktrees/`, `.claude/settings.local.json` and
`.claude/scheduled_tasks.lock` are local state, and gitignored. There is no root
`AGENTS.md`: the closest sibling has none, and a router file for an opt-in tool
would put back the root entry this decision removes.

A document under a dotted directory stays checked. `check:spelling` now globs
dotted directories, as `check:links` and `check:md` already did, so a file moved
into `.claude/` or `.github/` does not silently leave the spell check. All three
skip `.claude/worktrees/`, which holds nested copies of this repository.

### 4. Governance lives at `docs/governance.md`

Its headings, and so its anchors, are unchanged: `#compatibility-review` and
`#decision-process` resolve at the new path. Accepted ADRs that link to it have
only their link targets rewritten, under ADR 0021 §4. Their prose still says
`GOVERNANCE.md`, which is where the rule stood when they were decided.

### 5. The fixture format lives at `docs/conformance.md`

The root `conformance/` directory is removed. ADR 0021 §2 kept it at the root
because the fixture format is suite-level and is contract. Both reasons still
hold, and neither needs a directory of its own. `docs/conformance.md` is
normative, unlike the guides beside it, and
[What is normative](../../specifications/README.md#what-is-normative) says so
where the normative parts are defined.

The release archive does not change. Its member stays `conformance/README.md`,
beside the corpus, as ADR 0023 §6 fixes it. `tools/src/lib/layout.ts` now names
the source path and the archive member separately, so a later move in this tree
cannot move the member.

The `conformance` commit scope now means `docs/conformance.md` alone. No release
package holds that path, so a change to it releases nothing.

## Alternatives considered

**Keep `.editorconfig`.** It serves contributors outside the container, and this
is a public specification anyone may patch. Rejected because those contributors
keep every gate that matters, and because the rest of the organization states
editor intent in one place that this repository did not.

**`.github/GOVERNANCE.md`.** It would sit beside `CONTRIBUTING.md` and
`SECURITY.md`. Rejected because GitHub gives the file no special treatment
there, and because `docs/` is where the sibling registry keeps it and where the
documentation index lists it.

**`specifications/conformance.md`.** Beside the normative content, and outside
every release package. Rejected in favour of `docs/`, where the documentation
index already lists it by audience. Its normative status is stated where the
normative parts are defined, rather than implied by the directory it sits in.

**Move `LICENSE` into `.github/`.** Rejected. Licensee, which GitHub uses to
detect a licence, scores only files at the root and in a root `LICENSES/`
directory, so the repository would lose its detected Apache-2.0 licence.
`NOTICE` stays beside it, and both are copied into every release archive.

**Accept this ADR in a pull request of its own.**
[CONTRIBUTING](../../.github/CONTRIBUTING.md#proposing-a-structural-change) asks
for that. Rejected for this change only, by maintainer decision: the ADR decides
where five entries live, and landing it with the moves means `main` never holds
a layout no accepted ADR describes. Like ADR 0021's exception, it sets no
precedent.

## Consequences

- `task check:config` reports CFG-01..CFG-09. CFG-01..CFG-08 remain the codes
  shared with `musher-dev/development-container` and `musher-dev/platform`;
  CFG-09 is this repository's own.
- A contributor editing outside the dev container gets no whitespace hints from
  the repository. The checks named in §2 still fail what matters.
- Accepted ADRs keep `GOVERNANCE.md`, `CLAUDE.md`, `.editorconfig` and
  `conformance/README.md` in their prose. That is what immutability means; the
  ADR index points from ADR 0011 and ADR 0021 to this record.
- The spell check now covers `.github/` and `.config/` prose that it silently
  skipped before.

## Follow-ups

1. `musher-dev/company`'s `CONFIGURATION.md` says this repository keeps
   `.editorconfig`. It no longer does, and the line should be corrected there.
