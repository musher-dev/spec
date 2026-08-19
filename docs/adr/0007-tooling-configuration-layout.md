# ADR 0007: Tool configuration lives in `.config/`, passed by path

- **Status:** Accepted
- **Date:** 2026-08-19
- **Refines:** [ADR 0001](0001-canonical-repository-architecture.md)

## Context

A repository root accumulates dotfiles the way a desktop accumulates icons.
Nothing forces them elsewhere, every tool's README says "drop the dotfile at the
repo root", and once five or six are there the listing reads as a junk drawer.
This one held `lefthook.yml`, `cspell.json`, `.cspell/`, `.editorconfig`,
`.gitignore` and `.gitattributes` beside the normative content and the project
documents, and a reader could not tell which of those *must* be at the root from
which merely *default* to it.

That distinction is the whole problem. Git, EditorConfig and Task genuinely have
nowhere else to go: none accepts a flag naming its config. Lefthook and cspell
were there because nobody told them otherwise. The two look identical in a
directory listing, so every new linter arrives at the root by default and the
set only grows.

`musher-dev/development-container` and `musher-dev/platform` already solved
this, and share one convention between them. Adopting a third variant here would
cost a contributor moving between the three repositories the one thing the
convention buys: knowing where the linter configs are without looking.

Platform's own history supplies the warning about how to adopt it. Its rule
shipped as prose with no mechanical enforcement, and in that state two
non-configuration files accreted inside the directory and four lint tools ran on
defaults with no config at all. A convention that only review enforces decays at
the speed of review.

## Decision

### 1. Four homes, and an ordered rule for choosing between them

For a given configuration file, ask in order and stop at the first "yes":

1. Can the tool **only** load from a fixed location, with no flag pointing
   elsewhere? → the repo root. `Taskfile.yml`, `.gitignore`, `.gitattributes`,
   `.editorconfig`. No alternative exists.
2. Does it configure a linter, formatter, or the git hooks? →
   `.config/<concern>/`.
3. Does it provision the container? → `.devcontainer/`.
4. Does it belong to the `tools/` package — declared by it, resolved by it? →
   `tools/`. See §5.

The directory is dotted because it is machinery, and it sits beside the
machinery the repository already has: `.devcontainer/`, `.github/`. What is
visible at the root is content you edit; what is dotted operates on it.

### 2. Bucket by concern, with one forced exception

`.config/<concern>/<tool>.<ext>`. A one-file bucket is fine and collects
siblings over time. Filenames carry no leading dot — the directory is already
dotted, and a second dot advertises a discovery mechanism deliberately not in
use.

`lefthook.yml` sits at the top level, and that is a constraint rather than a
preference. Lefthook's config search is first-match-wins over `lefthook.*` →
`.lefthook.*` → `.config/lefthook.*` and does not descend further, so bucketing
it would make it undiscoverable and every hook would stop running with no
warning. The same search is why a stray `lefthook.yml` at the root would
silently shadow this one, which is what CFG-06 exists to catch.

### 3. Every caller passes the path explicitly

Except lefthook, every caller names its config with the tool's own flag. Default
discovery is what scattered these files to the root to begin with; it is also
what lets a developer's personal `~/.config` file change what CI accepts.

Adding a config carries one obligation beyond writing it: **verify the flag is
live** by pointing the tool at a path that does not exist and confirming it
fails. A silently-ignored `--config` is precisely the failure this directory
exists to prevent, and it is one command to rule out.

Moving cspell demonstrated the sharper version of the same hazard. cspell
resolves `ignorePaths` against `globRoot`, which defaults to the config file's
own directory — so the move re-rooted every repo-relative ignore against
`.config/spelling/`, where none of them matched. The check kept passing while
covering strictly less. It was caught by comparing the file count before and
after the move, not by the check failing, because a check that has stopped
enforcing anything does not fail. `globRoot` is now set explicitly, with a
comment saying why.

### 4. The layout is a build failure, not a convention

`tools/src/config.ts`, run as `task check:config`, enforces CFG-01..CFG-08: the
directory and its index exist; every file has an index row and a caller; no
leading-dot filenames; no root file shadowing lefthook; nothing but the index
and lefthook at the top level; no stray tool config at the root; no executables.

The codes are deliberately identical to the ones the two sibling repositories
report from their Python `repo config check`. Three repositories, one
convention, one vocabulary for reporting a breach of it.

There is **no** automated check that a config's *contents* are right — only that
it exists, is indexed, is reachable, and is a declaration. Judging whether a
given relaxation is justified is review's job, which is why every suppression
carries a written reason.

### 5. Package configuration stays with its package

`tools/biome.json` and `tools/tsconfig.json` do not move. They configure the
`tools/` package, are resolved relative to it, and travel with `package.json`
and the lockfile. `.config/` is for repo-level files passed by an explicit path;
a package's own config is neither.

This mirrors the carve-out platform reached from the opposite direction, where
shared frontend configs outgrew `.config/` and became a workspace package once
they needed to own their dependencies.

## Alternatives considered

**Leave the configs at the root.** Zero migration cost, and every tool's
documented default. Rejected because it is the state that produced the problem:
the root grows monotonically, and nothing distinguishes root-by-necessity from
root-by-default until someone tries to move one and discovers which it was.

**A `config/` directory without the leading dot.** More discoverable to a
newcomer, and it would sort with the content directories. Rejected for that
same reason — it would sort with `specifications/` and `conformance/`, which
are the contract.
Tooling configuration is not content, and the root listing is more useful when
the two are visibly different kinds of thing.

**Port the sibling repositories' Python `repo` CLI.** It is the same rules
already written and already maintained. Rejected because this repository has no
Python: adding an interpreter, a dependency manager and an isolated environment
to CI to run one static check would be a larger and longer-lived cost than the
~200 lines of TypeScript that sit beside the eleven checks already in
`tools/src/`. The
codes are shared instead of the implementation, which is the part a contributor
actually reads.

**Adopt the sibling repositories' codespell rather than keeping cspell.** It
would make the spelling bucket byte-identical across the three. Rejected because
cspell already carries this repository's domain dictionary and its
`ignoreRegExpList` is tuned to schema and anchor syntax; converging on the tool
would cost more than the divergence does. The bucket, the flag and the rules are
shared; the tool inside it need not be.

## Consequences

- The root holds normative content, project documents, and the four files that
  can be nowhere else. Every other tool config is one `ls .config/` away, and
  `.config/README.md` names the flag that reaches each one.
- Adding a linter now has a fixed shape: config in a bucket, a row in the index,
  an explicit path at the call site, a pinned version, and a written reason for
  every suppression. `task check:config` fails the build if any of the first
  three is missing.
- A config nothing reads can no longer sit in the tree looking authoritative,
  and a root `lefthook.yml` can no longer silently replace the hooks.
- `tools/src/config.test.ts` provokes every code against a throwaway tree. A
  gate that cannot fail is indistinguishable from no gate, and two of these
  rules guard failures that are silent by nature.
- The convention is now shared with `musher-dev/development-container` and
  `musher-dev/platform`. That is an obligation as much as a benefit: a change to
  the shape here should be raised against the other two rather than forked.

## Follow-ups

1. **The spelling tool diverges from the siblings.** They run codespell; this
   runs cspell. The bucket and the rules match, the tool does not, so a
   contributor moving between repositories still learns two commands. Revisit if
   the domain dictionary can be expressed in codespell's format without loss.
2. **Version pinning is split across two files.** Bun-installed tools are pinned
   in `tools/package.json`; the rest are pinned in `.devcontainer/mise.toml` and
   mirrored in `.github/workflows/ci.yml`, because CI is not a mise host and
   does not read that file. The mirrors are held in step by comment, not by a
   check. The sibling repositories have the same seam.
