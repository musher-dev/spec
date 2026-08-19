# ADR 0012: Publication moves to Cloudflare Pages, and the cache contract moves into this repository

- **Status:** Accepted
- **Date:** 2026-08-19
- **Supersedes:** [ADR 0001](0001-canonical-repository-architecture.md) §5
- **Refines:** [ADR 0001](0001-canonical-repository-architecture.md) §1
- **Closes:** [ADR 0006](0006-publication-from-tags.md) follow-up 1

## Context

Every `$id` this repository publishes is a dead URL. `schemas.musher.dev` has never
resolved, and `gh api repos/musher-dev/spec/pages` reports `cname: null`.
`musher-dev/infra` is standing the hostname up now, and doing so established that
[ADR 0001](0001-canonical-repository-architecture.md) §5 cannot hold as written.

It specifies "a GitHub Pages artifact fronted by Cloudflare, which supplies the
immutable cache headers Pages cannot set itself". Both halves cannot be true at once:

1. **GitHub cannot renew a custom domain's TLS certificate behind an orange cloud.**
   Issuance and renewal resolve the hostname and require GitHub's own addresses in the
   answer; proxied, they see Cloudflare anycast instead.
   [`github/pages-health-check#153`](https://github.com/github/pages-health-check/issues/153)
   has been open since 2023, and the advice in-thread from a former GitHub Pages
   engineer is to turn proxying off. Left on, it fails at roughly ninety days as a hard
   `525` on every published `$id`. But proxying is precisely what the immutable cache
   headers require — it is the only reason Cloudflare was in the path.
2. **The workarounds are plan-gated.** Origin Rules' Host-header, SNI and DNS-record
   overrides are Enterprise-only, and the `matches` operator needed to separate
   `/v1.2.3/` from `/v1/` is Business and above. The `musher.dev` zone is Free.

Cloudflare Pages dissolves both. Cloudflare terminates TLS for the hostname natively,
so no third-party certificate exists to expire, and `_headers` sets the cache policy at
the origin. [ADR 0006](0006-publication-from-tags.md) anticipated the move — *"Revisit
when publication outgrows Pages"* — and its reasoning against R2 does not transfer: the
artifact is still built in-repo by the same gated pipeline, and only the upload target
changes.

This also discharges ADR 0006 follow-up 1, which asked for the versioned path's cache
rule to be recorded here. It is better than recorded: it is generated, from the same
enumeration that writes the tree. ADR 0001 follow-up 1 assigned both the DNS record and
the cache rule to `musher-dev/infra`; the DNS half stays there, and the cache half ends
here.

## Decision

### 1. The origin is Cloudflare Pages

`.github/workflows/pages.yml` uploads with `wrangler pages deploy` in place of
`actions/upload-pages-artifact` and `actions/deploy-pages`. The `environment:
github-pages` block and the `pages: write` / `id-token: write` grants go with them.

Everything the publication guarantee rests on is unchanged: `fetch-depth: 0`, the
`check:drift` and `check:published` gates ahead of the upload, and the job-level
`pages-deploy` concurrency group that never cancels in flight.

### 2. `_headers` is generated, and no two of its rules overlap

Cloudflare Pages applies **every** rule whose pattern matches, and joins duplicate
header names with a comma. A more specific rule does not override a general one. So the
obvious shape — one broad rule for pinned paths plus per-alias overrides — emits

```
Cache-Control: public, max-age=31536000, immutable, public, max-age=300, must-revalidate
```

and the alias is cached for a year. The rules must therefore partition: for any served
path, at most one matching rule may set a given header name.

`tools/src/site.ts` already enumerates every path it writes and already knows which are
aliases and which are pinned, so it emits `_headers` with no second source of truth to
keep in step. Three rules key on a path *shape* and set headers nothing else sets;
`Cache-Control` is set by one exact rule per alias and inventory, and one directory rule
per released version.

```text
/*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff

/*.schema.json
  Content-Type: application/schema+json; charset=utf-8

/component/v1/component.schema.json
  Cache-Control: public, max-age=300, must-revalidate

/component/v1.0.0/*
  Cache-Control: public, max-age=31536000, immutable
```

`application/schema+json` with `public, max-age=31536000, immutable` is what
`json-schema.org` serves for the same kind of document.

Three properties are worth stating because each is easy to lose later.

**The partition is enforced, not documented.** `assertNoOverlap` runs over the paths
actually written on every build. A new artifact cannot quietly acquire a second opinion
about how long it may be cached, and the check cannot fall behind the tree because it
reads the tree.

**A release costs one rule, not two.** The directory rule covers a version's schema and
its `.sha256` sidecar together, and the sidecar is exactly as immutable as the bytes it
attests. `_headers` caps at one hundred rules; the build fails at ninety, which leaves
room for roughly eighty published versions across the three families. Failing early
matters because a file over the ceiling is rejected wholesale — the failure mode is not
a truncated policy but no policy at all.

**Silence is safe.** Pages serves any uncontested asset as `public, max-age=0,
must-revalidate`. A path this file forgets therefore revalidates rather than pinning
stale bytes, which is why the pages in §4 take no rule at all.

Two of the headers above restate Pages defaults. Cloudflare already sends
`Access-Control-Allow-Origin: *` and `X-Content-Type-Options: nosniff`, and `_headers`
overrides a default rather than appending to it. They are pinned anyway: README
instructs editors and browser-based validators to fetch these URLs cross-origin, so CORS
is a guarantee this repository makes, and a guarantee resting on a vendor default is one
that can be withdrawn without a commit here.

### 3. The published tree carries no GitHub Pages artifacts

`CNAME` and `.nojekyll` are no longer written.

`CNAME` never did anything. GitHub's documentation is explicit that for an
Actions-published Pages site "no `CNAME` file is created, and any existing `CNAME` file
is ignored and is not required" — which is why `cname` reads `null` today despite
successful deploys. On Cloudflare Pages it would simply be served as a static file at
`https://schemas.musher.dev/CNAME`. `.nojekyll` guards against a Jekyll build that
Cloudflare Pages does not run.

### 4. The origin has a human entry point

`site.ts` emits `index.html` at the root and under each family, and a `404.html`.

The root page names each family, its alias URL, its latest version, its `versions.json`,
and its prose. A family page lists every published version with its tag and checksum,
and says plainly when a family has released nothing and its alias is tracking `main` —
which is the state of all three families today.

Generated rather than committed, for the reason `docs/traceability.md` is generated: a
page someone has to remember to update is a page that is wrong. Each link to a `spec.md`
resolves at the ref the reader is actually looking at — a released alias points at its
tag, an unreleased one at `main` — so the page cannot quietly offer prose that does not
match the schema beside it.

Deliberately thin. This is a registry, not a documentation site; the normative prose
stays in each family's `spec.md`, and nothing here is normative.

### 5. `musher-dev/specs` is archived, not deleted

[ADR 0001](0001-canonical-repository-architecture.md) §1 said the superseded repository
"is superseded and will be deleted". It has been archived instead, and archived is the
better end state: deletion would `404` every inbound reference to it, including ADR
0001's own account of why this repository exists. An archived repository is read-only,
carries GitHub's own banner saying so, and keeps the history that explains the
supersession legible.

One consequence is live rather than historical. That repository's README advertises
`schemas.musher.dev` URLs that were never served, and that hostname now resolves to
*this* repository's content — so it describes a contract it does not define. Its
retirement is finished by dropping `specs` from the organisation's `pr-workflow`
ruleset, which no change here can do.

### 6. The deploy credential

A push to `main` in a public repository now reaches a Cloudflare credential. That is the
genuine cost of this decision and is stated rather than mitigated away.

What bounds it: the token is scoped to the one Pages project; `task site:deploy` refuses
to run unless both secrets are present, so a missing credential fails the job rather
than deploying anonymously; `check:drift` and `check:published` still run *before* the
credential is used, so an unreviewed bundle or a moved release stops the job first; and
wrangler is pinned in `tools/package.json` and `tools/bun.lock` rather than resolved at
deploy time, so the code that receives the token changes only through a reviewed
lockfile diff under CODEOWNERS.

## Alternatives considered

**Keep GitHub Pages and turn proxying off.** This is the upstream advice, and it fixes
certificate renewal. It also removes the only thing Cloudflare was doing — Pages cannot
set `Cache-Control`, so every pinned URL loses the immutability README promises it.
Solving the certificate by discarding the guarantee is not solving it.

**A Cloudflare Worker in front of Pages.** Expressive enough to compute cache policy
from the path shape, and not plan-gated. But it is a second deployable that has to stay
in step with `site.ts`'s idea of which paths are pinned, and a policy expressed in code
running elsewhere is exactly the arrangement ADR 0006 follow-up 1 complained about.
`_headers` makes the same guarantee with nothing at runtime.

**Write-once object storage (R2).** Still the correct end state at scale, and still
premature for the same reasons [ADR 0006](0006-publication-from-tags.md) gave. This
change does not move away from it; the tree is assembled identically either way.

## Consequences

**Positive**

- Every published `$id` becomes a URL that resolves, with a certificate that renews.
- The caching half of the immutability promise is reviewable in a pull request, beside
  the bytes it applies to, and is verified by the test suite rather than by inspection
  of another repository's Terraform.
- `/` and `/<family>/` stop being `404`s.
- The rule budget makes the publication model's growth visible: the file that would
  break is the file that fails the build.

**Negative**

- A Cloudflare credential is reachable from `main`, per §6.
- `wrangler` is a large dependency tree for one command, and it is the only tool here
  whose job is to hold a secret.
- `application/schema+json` prompts a download in a browser where `application/json`
  renders inline. That is the correct media type and what the canonical registry serves;
  the index pages in §4 are what a human following a URL upward now lands on instead.
- The published origin can no longer be reproduced by reading `pages.yml` alone — the
  Pages project and its custom domain live in `musher-dev/infra`.

## Follow-ups

1. Emit `Deprecation` and `Sunset` for a deprecated release. GOVERNANCE.md →
   Deprecation and retirement promises those headers; nothing emits them, the ledger
   has no field recording that a version is deprecated, and no version is. `_headers`
   is now where they would go, and the ledger is where the fact would have to live.
2. Drop `specs` from the organisation ruleset that still names it, completing §5. No
   infrastructure-as-code layer can create or destroy a repository, so this is
   necessarily manual.
3. Confirm the served headers against the acceptance `curl` once `musher-dev/infra`
   applies the Cloudflare token. Pinned-path immutability cannot be observed until a
   family is tagged; until then the fixture suite is the only place it is exercised.
