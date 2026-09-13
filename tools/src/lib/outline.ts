/**
 * The outline of a `spec.md`: its numbered sections, and the section each
 * requirement ID is declared under.
 *
 * Three callers read the same shape, and used to carry a copy of the heading
 * pattern each: `prose.ts` turns a bare "§6.1" into a link, `traceability.ts`
 * shows each requirement against the clause stating it, and the conformance
 * runner checks that a case's `clause` encloses the requirements it pins. Three
 * copies of one pattern are three chances for the same heading to belong to
 * different sections, so it lives here.
 *
 * NON-NORMATIVE, like everything under tools/.
 */

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
  /** Requirement id to the id of the section stating it, in document order. */
  readonly requirements: ReadonlyMap<string, string>
  /** Section number to anchor id, so `spec.md §5.2` can become a link. */
  readonly byNumber: ReadonlyMap<string, string>
}

/** A section heading carrying a stable anchor. `##` and `###` only. */
const HEADING = /^(#{2,3})\s+<a id="([^"]+)"><\/a>\s*([0-9.]+)?\s*(.+?)\s*$/
/** A stable requirement identifier: `CORE-ENV-001`, `BP-REF-003`. */
export const REQUIREMENT_ID = /^[A-Z]{2,6}-[A-Z0-9]{2,12}-\d{3}$/
/** Any explicit anchor, wherever it sits. */
const ANCHOR = /<a id="([^"]+)"><\/a>/g

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
      const [, hashes = '', id = '', number = '', title = ''] = heading
      current = id
      // `2.` and `7.1` are both authored; the trailing dot on a top-level
      // number is punctuation, not part of the number a citation names.
      const numbered = number.trim().replace(/\.$/, '')
      sections.push({ id, number: numbered, title, level: hashes.length })
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

/**
 * The sections enclosing a requirement, innermost first: the section it is
 * declared under, then that section's parent, and so on to the top level.
 *
 * A section's parent is the nearest preceding section of a lower level, which
 * is what the heading levels say. Empty when the ID is not declared here, or is
 * declared before the first heading.
 */
export function enclosingSections(outline: Outline, requirement: string): string[] {
  const declaredUnder = outline.requirements.get(requirement)
  if (declaredUnder === undefined || declaredUnder === '') return []
  const index = outline.sections.findIndex((section) => section.id === declaredUnder)
  if (index === -1) return []

  const chain: string[] = []
  let level = Number.POSITIVE_INFINITY
  for (let i = index; i >= 0; i -= 1) {
    const section = outline.sections[i] as Section
    if (section.level < level) {
      chain.push(section.id)
      level = section.level
    }
  }
  return chain
}
