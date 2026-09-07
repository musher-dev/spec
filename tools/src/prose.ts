/**
 * Render this repository's own Markdown as HTML for the publication site.
 *
 * The prose is normative and the rendering is not, so this module's whole job
 * is to lose nothing on the way through. Three properties carry that:
 *
 * 1. **Anchors survive.** `spec.md` carries explicit `<a id="envelope"></a>` and
 *    `<a id="COMP-ENV-001"></a>` anchors. Conformance `metadata.clause` cites the
 *    first kind and `docs/traceability.md` links the second, so an anchor dropped
 *    here is a citation that silently stops resolving. CommonMark's renderer is
 *    therefore run with `safe: false`; `safe: true` replaces every one of them
 *    with `<!-- raw HTML omitted -->`.
 * 2. **Tables survive.** CommonMark has no tables, and the three `spec.md` files
 *    carry 25 of them — the requirement registries, the diagnostics registries
 *    and the kind-by-field matrix are all tables, and they are the densest
 *    normative content in the repository. `splitTables` handles them; see its
 *    docblock for why a line-level split is sound here and what it refuses.
 * 3. **A link either resolves or fails the build.** `check:links` exists because
 *    a citation that still looks like a link and goes nowhere is worse than no
 *    citation. Generated output earns the same rule, so an unclassifiable target
 *    throws rather than shipping.
 *
 * Raw HTML passes through, which is safe for *this* input and would not be for
 * instance data. ADR 0004 constrains a listing `description` to a CommonMark
 * profile with raw HTML forbidden, and `semantic.ts` enforces that separately;
 * the input here is this repository's own markdownlint-constrained prose, where
 * MD033 already admits exactly `a` and `br`.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { HtmlRenderer, Node, Parser } from 'commonmark'

/** A heading, as `## <a id="envelope"></a>2. Document envelope`. */
export interface Section {
  readonly id: string
  /** The authored section number, `2` or `7.1`, or '' where a heading has none. */
  readonly number: string
  readonly title: string
  readonly level: number
}

export interface Outline {
  readonly sections: readonly Section[]
  /** Requirement id to the id of the section stating it. */
  readonly requirements: ReadonlyMap<string, string>
  /** Section number to anchor id, so `spec.md §5.2` can become a link. */
  readonly byNumber: ReadonlyMap<string, string>
}

/**
 * Context a document needs to turn its own citations into links.
 *
 * `resolveLink` is injected rather than implemented here: which relative targets
 * are rewritable depends on what the site publishes, and that is `site.ts`'s
 * knowledge, not this module's.
 */
export interface ProseContext {
  /** URL path this document is served at, for same-document fragment links. */
  readonly base: string
  readonly outline: Outline
  /** Rewrite a relative Markdown target. MUST throw on one it cannot classify. */
  readonly resolveLink: (target: string) => string
}

/**
 * The heading form, shared with `traceability.ts`.
 *
 * Kept as a copy rather than an import: `traceability.ts` regenerates a
 * committed artifact and pulling it into this module's dependency graph would
 * put `docs/traceability.md` in the blast radius of a rendering change. If a
 * third caller appears, extract it then.
 */
const HEADING = /^#{2,3}\s+<a id="([^"]+)"><\/a>\s*([0-9.]+)?\s*(.+?)\s*$/
/** A stable requirement identifier, `COMP-ENV-001`. */
const REQUIREMENT_ID = /^[A-Z]{2,6}-[A-Z0-9]{2,12}-\d{3}$/
/** Any explicit anchor, wherever it sits. */
const ANCHOR = /<a id="([^"]+)"><\/a>/g
/** A citation to a numbered clause, `§5.2` or `spec.md §5.2`. */
const CITATION = /§\s?(\d+(?:\.\d+)*)/g

/**
 * Index a document's anchors: its sections, and the requirements under each.
 *
 * Both namespaces live in one file and neither is derivable from the other — a
 * section anchor is kebab-case and names a heading, a requirement id names a
 * single rule and is stable across a heading rename. That is exactly why both
 * exist; see `conformance/README.md`.
 */
export function readOutline(markdown: string): Outline {
  const sections: Section[] = []
  const requirements = new Map<string, string>()
  const byNumber = new Map<string, string>()
  let current = ''

  for (const line of markdown.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading !== null) {
      const [, id = '', number = '', title = ''] = heading
      current = id
      const level = line.startsWith('###') ? 3 : 2
      // `2.` and `7.1` are both authored; the trailing dot on a top-level
      // number is punctuation, not part of the number a citation names.
      const numbered = number.trim().replace(/\.$/, '')
      sections.push({ id, number: numbered, title, level })
      if (numbered !== '') byNumber.set(numbered, id)
      continue
    }
    // A requirement anchor sits in a table cell or glued to the start of an
    // ordinary sentence, so it is found by scanning every line rather than by
    // matching a shape.
    for (const match of line.matchAll(ANCHOR)) {
      const id = match[1]
      if (id !== undefined && REQUIREMENT_ID.test(id)) requirements.set(id, current)
    }
  }

  return { sections, requirements, byNumber }
}

/** A pipe table, lifted out of the Markdown so CommonMark never sees it. */
interface Table {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

type Segment =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'table'; readonly table: Table }

/** `|---|---|`, with no alignment colons — the only delimiter shape in use. */
const DELIMITER = /^\|[\s:|-]+\|$/

/**
 * Split the source into Markdown runs and tables.
 *
 * A line-level split is sound for this corpus and is verified rather than
 * assumed: no table in any `spec.md` is nested inside a blockquote or a list, no
 * delimiter row carries an alignment colon, and no cell escapes a pipe. The one
 * remaining way a naive split could mangle a table is a pipe inside a code span,
 * so `cells` refuses that outright instead of guessing. A future author who
 * writes one gets a build failure naming the line, which is the cheapest place
 * to find out.
 */
function splitTables(markdown: string, where: string): Segment[] {
  const lines = markdown.split('\n')
  const segments: Segment[] = []
  let run: string[] = []

  const flush = (): void => {
    if (run.length > 0) segments.push({ kind: 'markdown', text: run.join('\n') })
    run = []
  }

  let fence: string | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const next = lines[i + 1] ?? ''
    // A fenced block is opaque. Without this, a pipe table shown *as an
    // example* inside a fence would be lifted out as a real table and its
    // closing fence would re-open a code block, swallowing the rest of the
    // document — silently, which is the one outcome this module refuses.
    const opener = /^(```+|~~~+)/.exec(line.trim())
    if (fence === null && opener !== null) {
      fence = opener[1] ?? '```'
      run.push(line)
      continue
    }
    if (fence !== null) {
      if (line.trim().startsWith(fence)) fence = null
      run.push(line)
      continue
    }
    if (!line.startsWith('|') || !DELIMITER.test(next)) {
      run.push(line)
      continue
    }
    flush()
    const header = cells(line, where, i + 1)
    const rows: string[][] = []
    let cursor = i + 2
    while (cursor < lines.length && (lines[cursor] ?? '').startsWith('|')) {
      rows.push(cells(lines[cursor] ?? '', where, cursor + 1))
      cursor += 1
    }
    segments.push({ kind: 'table', table: { header, rows } })
    i = cursor - 1
  }

  flush()
  return segments
}

/** Split one row into cells, refusing the one shape a naive split would mangle. */
function cells(row: string, where: string, line: number): string[] {
  if (row.includes('\\|')) {
    throw new Error(
      `${where}:${line}: a table cell escapes a pipe. Tables here are split on the ` +
        'pipe, so this row cannot be rendered faithfully. Reword the cell, or teach ' +
        'prose.ts to parse the row properly.',
    )
  }
  for (const span of row.match(/`[^`\n]*`/g) ?? []) {
    if (span.includes('|')) {
      throw new Error(
        `${where}:${line}: a table cell holds a code span containing a pipe — ${span}. ` +
          'Tables here are split on the pipe, so this row cannot be rendered faithfully. ' +
          'Reword the cell, or teach prose.ts to parse the row properly.',
      )
    }
  }
  return row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

const parser = new Parser()
const renderer = new HtmlRenderer({ safe: false })

/**
 * Rewrite links and citations in place.
 *
 * Only `link` destinations and `text` literals are touched, so a URL inside a
 * code span stays a code span — that is the difference between walking the tree
 * and running a regular expression over the rendered HTML.
 */
function rewrite(root: Node, context: ProseContext | null): void {
  const walker = root.walker()
  let step = walker.next()
  /**
   * Depth of enclosing links. A citation inside a link's own label must be
   * left alone: wrapping it makes a nested `<a>`, which HTML forbids and the
   * parser splits into siblings, and the inner href would be resolved against
   * *this* document — so `[component §3](../../component/v1/spec.md#…)` would
   * render a "§3" pointing at this family's §3 instead of component's.
   */
  let inLink = 0
  while (step !== null) {
    const node = step.node
    if (node.type === 'link') {
      if (step.entering) {
        if (node.destination !== null && context !== null) {
          node.destination = context.resolveLink(node.destination)
        }
        inLink += 1
      } else {
        inLink -= 1
      }
    }
    if (
      step.entering &&
      inLink === 0 &&
      node.type === 'text' &&
      node.literal !== null &&
      context !== null
    ) {
      linkifyCitations(node, context)
    }
    step = walker.next()
  }
}

/**
 * Turn `§5.2` into a link to the clause it names.
 *
 * A number the outline does not know is left as plain text. Manufacturing a
 * fragment for a section that does not exist would produce exactly the dead
 * citation this module refuses elsewhere, and a reader cannot tell a dead
 * fragment from a live one by looking.
 */
function linkifyCitations(node: Node, context: ProseContext): void {
  const literal = node.literal ?? ''
  CITATION.lastIndex = 0
  if (!CITATION.test(literal)) return
  CITATION.lastIndex = 0

  let cursor = 0
  let last: Node = node
  const pieces: Node[] = []

  for (const match of literal.matchAll(CITATION)) {
    const number = match[1]
    const target = number === undefined ? undefined : context.outline.byNumber.get(number)
    if (target === undefined) continue
    const at = match.index ?? 0

    const before = new Node('text')
    before.literal = literal.slice(cursor, at)
    pieces.push(before)

    const link = new Node('link')
    link.destination = `${context.base}#${target}`
    const label = new Node('text')
    label.literal = match[0]
    link.appendChild(label)
    pieces.push(link)

    cursor = at + match[0].length
  }

  if (pieces.length === 0) return
  const tail = new Node('text')
  tail.literal = literal.slice(cursor)
  pieces.push(tail)

  for (const piece of pieces) {
    last.insertAfter(piece)
    last = piece
  }
  node.unlink()
}

function renderMarkdown(text: string, context: ProseContext | null): string {
  const parsed = parser.parse(text)
  rewrite(parsed, context)
  return renderer.render(parsed)
}

/** Render one cell's inline markup, without the paragraph CommonMark wraps it in. */
function renderCell(text: string, context: ProseContext | null): string {
  return renderMarkdown(text, context)
    .trim()
    .replace(/^<p>/, '')
    .replace(/<\/p>$/, '')
}

function renderTable(table: Table, context: ProseContext | null): string {
  const head = table.header.map((cell) => `<th>${renderCell(cell, context)}</th>`).join('')
  const body = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderCell(cell, context)}</td>`).join('')}</tr>`)
    .join('\n')
  // Wrapped so a wide registry table scrolls inside the page rather than
  // widening it; several of them carry five columns of prose.
  return `<div class="scroll"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`
}

/**
 * A whole Markdown document as an HTML fragment.
 *
 * `where` names the source for an error message; nothing else reads it.
 */
export function renderProse(markdown: string, context: ProseContext | null, where: string): string {
  return splitTables(markdown, where)
    .map((segment) =>
      segment.kind === 'table'
        ? renderTable(segment.table, context)
        : renderMarkdown(segment.text, context),
    )
    .join('\n')
}

/**
 * One `description` or `$comment` as an HTML fragment.
 *
 * Four descriptions carry reStructuredText ``double-backtick`` spans and
 * embedded blank lines, inherited from the platform's generated models. Both
 * are handled without pre-processing: CommonMark accepts any backtick run as a
 * code-span delimiter, and a blank line is already a paragraph break.
 */
export function renderInline(text: string, context: ProseContext | null): string {
  return renderMarkdown(text, context).trim()
}
