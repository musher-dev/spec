# ADR 0017: The registry publishes a generated field reference, and the hand-written one is retired

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** [ADR 0012](0012-cloudflare-pages-publication.md) §4
- **Refines:** [ADR 0012](0012-cloudflare-pages-publication.md) §2
- **Closes:** [ADR 0001](0001-canonical-repository-architecture.md) follow-up 3

## Context

[ADR 0001](0001-canonical-repository-architecture.md) follow-up 3 has been open
since this repository was bootstrapped: "Regenerate the public docs field
reference from these schemas, replacing the hand-written tables and the stale
bundle-format page."

What stands in its place is two hand-authored pages in `musher-dev/platform` —
`docs/product/src/routes/(docs)/reference/component-spec/+page.svelte` and
`blueprint-spec/+page.svelte` — and no `listing` page at all. One of the three
families this repository publishes is invisible in the documentation a reader is
sent to.

They have already drifted, and the drift is the demonstrable kind rather than
the arguable kind. The documented `component.yaml` example carries `metadata`
and `spec`. The published bundle requires `specVersion`, `kind`, `metadata` and
`spec`, and this repository's `catalog.json` binds `**/component.yaml` to that
bundle. An author who copies the documentation into the file the documentation
names gets validation errors from a schema the same organisation publishes.

This is the failure mode this repository already names and already designs
against. `docs/traceability.md` and `catalog.json` are generated, and
[ADR 0012](0012-cloudflare-pages-publication.md) §4 gives the reason in one
sentence: "a page someone has to remember to update is a page that is wrong."
The field reference is the last artifact of that shape still maintained by hand,
in another repository, where nothing checks it against the contract it describes.

The obstacle is ADR 0012 §4 itself, whose closing sentence reads:

> Deliberately thin. This is a registry, not a documentation site; the normative
> prose stays in each family's `spec.md`, and nothing here is normative.

That is two claims, and they do not stand or fall together.

## Decision

### 1. §4's thinness is reversed; nothing here becomes normative

The thinness half was right when it was written and is now the obstacle. §4 built
five index pages and correctly refused to let them accrete prose nobody
generated — an index page that grows hand-written field tables is the drift this
ADR is about, arriving here instead of downstream. ADR 0001 follow-up 3 asks for
something else: a reference *generated* from the artifacts, which cannot accrete
and cannot be forgotten.

The second half survives untouched, in those words. Nothing published
under `/reference/` is normative. The specification already said so before the
page existed — each family's `spec.md` lists "generated documentation" among its
informative artifacts, beside schema `description` fields and validator message
text. A normative artifact gains an informative rendering; nothing changes rank.

Where a rendering and the Markdown disagree, the Markdown is right and `tools/`
has a defect.

### 2. The namespace, and who emits it

```text
/reference/                          every family and version, and what each describes
/reference/<family>/<version>/       the field reference, generated from the bundle
/reference/<family>/<version>/spec/  that version's spec.md, rendered
```

Emitted by `tools/src/site.ts` and by nothing else. There is no `task reference`
and no committed HTML: a second generator writing into the published tree would
end the property that makes the cache contract trustworthy, which is that one
enumeration produces every path and every path's headers.

### 3. The reference describes the bytes the alias serves

For a released major the reference is built from the tag — the bundle through
`loadRelease`, the prose through `readBlobAtRef` — and for an unreleased major
from the working tree, which is exactly what the alias already does.

This extends §4's existing guarantee that "each link to a `spec.md` resolves at
the ref the reader is actually looking at" from the link to the content. Without
it the page would describe `main` beside a schema served from a tag, which is the
same drift as the platform's, produced by this repository instead.

The bug this rules out is invisible today. No family is tagged, so a reference
built from the working tree would pass every check and start lying on the first
release.

### 4. Every version gets a reference, and none of them is immutable

The reference is rendered for each version the registry serves: the moving alias
and every exact release. A reader who pinned `/component/v1.2.0/component.schema.json`
— pinned it precisely so it would not move — can read the fields of the bytes in
front of them rather than of whatever `main` says today.

What those pages are not is immutable, and the distinction is the whole reason
the namespace is top-level instead of a directory inside the release.

`/<family>/v<X.Y.Z>/` carries one `immutable` rule for a year, and
`check:published` hashes the schema rather than any rendering. HTML there would
be bytes at a URL this repository documents as immutable forever that had to be
rewritten whenever the renderer improved, with nothing to catch it. Under
`/reference/` the same page is a rendering that may be corrected, and a fix
reaches every version including released ones.

Nothing under `/reference/` takes an `_headers` rule at all. [ADR
0012](0012-cloudflare-pages-publication.md) §2's "Silence is safe" gives an
uncontested asset `public, max-age=0, must-revalidate`, which is what a
regenerated page wants, and it is what that ADR's index pages already get for
the same reason. So a release costs pages, not rules: the budget is untouched
however many versions accumulate, and adding a family adds nothing to it.

The release archive is unaffected either way. `release.yml` names its inputs
explicitly and ships the Markdown, never the rendering.

A family named `reference` would publish under this namespace and collide with
it. `site.ts` rejects one by name, because the alternative is a build failure
about an overlapping splat.

### 5. The renderer admits the two elements the linter admits

`<a id="…"></a>` and `<br>` — the set `.config/markdown/markdownlint.jsonc`
already permits in this repository's Markdown, so the renderer's allowlist and
the linter's are one decision rather than two that can diverge. The anchors are
not decoration: conformance `metadata.clause` cites them, `docs/traceability.md`
links them, and rendering them is what turns every requirement identifier into a
public URL.

This repository rejects raw HTML in a listing `description`
([ADR 0004](0004-listing-description-trust-boundary.md), `ERR_RAW_HTML`) because
CommonMark permits it by design. A renderer of this repository's own prose that
passed arbitrary HTML through would hold itself below the standard it holds its
users to.

### 6. A link that cannot be classified fails the build

Relative links in `spec.md` are rewritten: to another family's rendered prose
where one exists on this origin, and to the blob at the ref being described
otherwise. Anything the classifier does not recognise throws.

`check:links` exists because a citation that still looks like a link and goes
nowhere is worse than no citation. Generated output earns the same rule, and a
failed build is the cheapest place to spend it.

## Alternatives considered

**Keep §4's thinness and correct the platform pages by hand.** The status quo.
It drifted once, with three families and one maintainer, and a corrected copy is
still a copy — one that will drift again, harder to spot as stale than an
obviously absent page.

**Generate the reference in `musher-dev/platform` by fetching the bundle at build
time.** Puts the public contract's documentation behind a private repository's
build. It also leaves the `listing` family's page waiting on someone remembering
to add a route, which is how it came to be missing.

**A third-party JSON Schema documentation generator.** A new dependency inside
the one script that assembles the published origin, emitting markup nobody here
controls. None of them know about `x-musher-discriminator`,
`x-additionalPropertiesName`, the requirement identifiers, or the anchors
conformance fixtures cite — and the most established of them documents Draft-07
while every bundle here is 2020-12.

**Render only the moving alias.** It would halve the generated pages. It would
also leave a reader on an exact-version schema URL with no reference for the
bytes in front of them, which is the reader most likely to want one. Since the
namespace takes no cache rules, the saving is disk on a static host rather than
anything in the contract.

**Emit `Deprecation` and `Sunset` headers while `_headers` is being touched.**
[ADR 0012](0012-cloudflare-pages-publication.md) follow-up 1, deliberately left
open. It needs a new field in the ledger and a deprecated release to emit for;
`published.json` records none, and folding a change to the publication ledger
into a documentation change would make both harder to review.

## Consequences

**Positive**

- ADR 0001 follow-up 3 closes, six weeks after it opened.
- The `listing` family is documented for the first time.
- Every requirement anchor becomes a URL that resolves without a GitHub account.
- `application/schema+json` prompting a download — named as a cost in ADR 0012 —
  now has a human page behind it rather than only an index row.
- The documentation cannot drift from the schema, because it is not a copy of it.

**Negative**

- A Markdown renderer and an HTML generator now live in `tools/`, and both are
  code that can be wrong in ways a schema cannot. Their correctness rests on unit
  tests rather than on a validator.
- Renaming a heading anchor is now an inbound-link break from another repository,
  not only a broken citation here. Nothing checks that direction.
- `site.ts` grows, and the "one script generates everything" property is worth
  more the larger that script gets.

## Follow-ups

1. Retire the hand-written field tables in `musher-dev/platform`. The two pages
   there are not the same artifact and do not take the same treatment.
   `reference/component-spec` documents the authoring document, so its field
   tables give way to a link here — while keeping what this repository does not
   define and should not: the three-block ownership model, the lifecycle states
   and the operations that drive them, and the monotonic-version rule.
   `reference/blueprint-spec` documents the compose endpoint's request body
   rather than the blueprint document, so it is reframed and linked, never
   retired; stubbing it would delete the only public description of that
   endpoint's shape. A `listing` page is added, which has never existed. The
   drifted `component.yaml` example is deleted rather than corrected, because a
   corrected copy is still a copy and will drift again on the next minor.
   Nothing in this repository can do any of it, and none of it may start before
   `/reference/` is deployed.
2. Consider publishing `docs/traceability.md` under `/reference/`. It is the map
   from a requirement to the clause stating it and the cases pinning it, it is
   already generated, and it is currently readable only on GitHub.
3. Nothing checks the inbound links other repositories make into these anchors.
   `check:links` covers citations inside this repository only.

[ADR 0012](0012-cloudflare-pages-publication.md) follow-ups 1 and 3 remain open
and are untouched here.
