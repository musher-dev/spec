/**
 * Read the parameters a kind family binds to core, out of its own §2.
 *
 * Core v1 §1.1 leaves a family four things to decide — its `kind` constant, the
 * section that defines its `metadata`, the fields that accept `null`, and the
 * name of its item document — and a family names the specifications it depends
 * on. Each family's §2 states them in two tables of a fixed shape
 * (docs/adr/0022). They are tables precisely so this module can read them: the
 * schema lint compares the `kind` constant, and the conformance runner resolves
 * a family's diagnostic registry through its dependencies.
 *
 * A spec with neither table yields `null`, which is today's tree. A spec with
 * one table and not the other, or a table whose rows do not have the template's
 * shape, throws — a binding that fails to parse must not read as "unbound".
 *
 * NON-NORMATIVE. The tables in spec.md are the rule; this only reads them.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Family } from './layout.ts'

/** A section citation in a bindings cell: `[§3](#metadata)`. */
export interface SectionRef {
  /** The section number as written, without `§`, e.g. `3` or `4.3`. */
  readonly number: string
  /** The anchor, without `#`. */
  readonly anchor: string
}

/** One row of the "Normative dependencies" table. */
export interface Dependency {
  /** The family name, e.g. `core`. */
  readonly family: string
  /** The major line depended on, e.g. `v1`. */
  readonly line: string
}

export interface FamilyBindings {
  /** The `kind` constant, e.g. `COMPONENT`. */
  readonly kind: string
  /** The section of this family's spec that defines `metadata`. */
  readonly metadataSection: SectionRef
  /** Fields that accept `null`, as written in their code spans. Empty for "none". */
  readonly nullFields: readonly string[]
  /** The item document's file name, or null when the kind sits inside an item. */
  readonly itemDocument: string | null
  /** Every normative dependency, in table order. */
  readonly dependencies: readonly Dependency[]
}

/** A bindings table is present but does not have the template's shape. */
export class BindingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BindingsError'
  }
}

const ENVELOPE_HEADING = /^##\s+<a id="envelope"><\/a>/
const SECTION_HEADING = /^##\s/
const DELIMITER_ROW = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/

const PARAMETER_HEADER = ['Core parameter', 'This family']
const DEPENDENCY_HEADER = ['Specification', 'Line']

const KIND_VALUE = /^`([A-Z][A-Z0-9_]*)`$/
const SECTION_VALUE = /^\[§(\d+(?:\.\d+)*)\]\(#([^)\s]+)\)$/
const CODE_SPAN = /`([^`]+)`/
const ITEM_DOCUMENT_VALUE = /^`([a-z][a-z0-9-]*\.yaml)`$/
const NO_ITEM_DOCUMENT = /^No\b/
const NONE = /^none\.?$/i
const DEPENDENCY_LINK = /^\[([a-z][a-z0-9-]*)\]\(([^)\s]+)\)$/
const LINE_VALUE = /^`?(v\d+)`?$/

/** The lines of §2 — from the envelope heading to the next `##` heading. */
function envelopeSection(markdown: string): string[] | null {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => ENVELOPE_HEADING.test(line))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => SECTION_HEADING.test(line))
  return end === -1 ? rest : rest.slice(0, end)
}

/** Split one Markdown table row into trimmed cells. No bindings cell carries a pipe. */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * The body rows of the table whose header is exactly `header`, or null when the
 * section has no such table.
 */
function tableRows(section: readonly string[], header: readonly string[]): string[][] | null {
  for (let index = 0; index < section.length; index += 1) {
    const line = section[index] as string
    if (!line.trimStart().startsWith('|')) continue
    const found = cells(line)
    if (found.length !== header.length || found.some((cell, i) => cell !== header[i])) continue

    if (!DELIMITER_ROW.test((section[index + 1] ?? '').trim())) {
      throw new BindingsError(`the "${header.join(' | ')}" table has no delimiter row`)
    }
    const rows: string[][] = []
    for (const row of section.slice(index + 2)) {
      if (!row.trimStart().startsWith('|')) break
      const parsed = cells(row)
      if (parsed.length !== header.length) {
        throw new BindingsError(
          `the "${header.join(' | ')}" table has a row with ${parsed.length} cell(s): ${row.trim()}`,
        )
      }
      rows.push(parsed)
    }
    return rows
  }
  return null
}

type ParameterKey = 'kind' | 'metadata' | 'nullFields' | 'itemDocument'

/** Which core parameter a row's first cell names. */
function parameterOf(label: string): ParameterKey {
  if (label.startsWith('`kind`')) return 'kind'
  if (label.startsWith('`metadata`')) return 'metadata'
  if (label.startsWith('Fields accepting `null`')) return 'nullFields'
  if (label.startsWith('Item document')) return 'itemDocument'
  throw new BindingsError(`"${label}" is not a core parameter this table may bind`)
}

function parseParameters(rows: readonly string[][]): Omit<FamilyBindings, 'dependencies'> {
  const values = new Map<ParameterKey, string>()
  for (const [label = '', value = ''] of rows) {
    const key = parameterOf(label)
    if (values.has(key)) throw new BindingsError(`core parameter ${key} is bound twice`)
    values.set(key, value)
  }
  const missing = (['kind', 'metadata', 'nullFields', 'itemDocument'] as const).filter(
    (key) => !values.has(key),
  )
  if (missing.length > 0) {
    throw new BindingsError(`the parameters table does not bind ${missing.join(', ')}`)
  }

  const kindCell = values.get('kind') as string
  const kind = KIND_VALUE.exec(kindCell)?.[1]
  if (kind === undefined) {
    throw new BindingsError(`kind must be one UPPER_SNAKE_CASE code span, got ${kindCell}`)
  }

  const metadataCell = values.get('metadata') as string
  const section = SECTION_VALUE.exec(metadataCell)
  if (section?.[1] === undefined || section[2] === undefined) {
    throw new BindingsError(
      `metadata must be one section link like [§3](#metadata), got ${metadataCell}`,
    )
  }

  const nullCell = values.get('nullFields') as string
  const nullFields = NONE.test(nullCell)
    ? []
    : nullCell.split(/;|,|<br>/).map((entry) => {
        const field = CODE_SPAN.exec(entry)?.[1]
        if (field === undefined) {
          throw new BindingsError(
            `each field accepting null must be a code span, or the cell must read "none", got ${nullCell}`,
          )
        }
        return field
      })

  const itemCell = values.get('itemDocument') as string
  let itemDocument: string | null
  if (NO_ITEM_DOCUMENT.test(itemCell)) {
    itemDocument = null
  } else {
    const name = ITEM_DOCUMENT_VALUE.exec(itemCell)?.[1]
    if (name === undefined) {
      throw new BindingsError(
        `item document must be a code span naming a .yaml file, or begin "No", got ${itemCell}`,
      )
    }
    itemDocument = name
  }

  return {
    kind,
    metadataSection: { number: section[1], anchor: section[2] },
    nullFields,
    itemDocument,
  }
}

function parseDependencies(rows: readonly string[][]): Dependency[] {
  const dependencies: Dependency[] = []
  for (const [specification = '', lineCell = ''] of rows) {
    const linked = DEPENDENCY_LINK.exec(specification)
    const family = linked?.[1]
    const href = linked?.[2]
    const line = LINE_VALUE.exec(lineCell)?.[1]
    if (family === undefined || href === undefined || line === undefined) {
      throw new BindingsError(
        `a dependency row must read | [<family>](<path>) | v<N> |, got | ${specification} | ${lineCell} |`,
      )
    }
    // The link and the row must name the same thing, or a reader following the
    // link lands on a specification the tooling is not reading.
    if (!href.endsWith(`/${family}/${line}/spec.md`)) {
      throw new BindingsError(
        `the ${family} ${line} dependency links to ${href}, which is not that family version's spec.md`,
      )
    }
    if (dependencies.some((d) => d.family === family)) {
      throw new BindingsError(`${family} is listed as a dependency twice`)
    }
    dependencies.push({ family, line })
  }
  if (dependencies.length === 0) {
    throw new BindingsError('the normative dependencies table lists nothing')
  }
  return dependencies
}

/**
 * Parse a family's §2 bindings. Null when the spec carries neither table.
 *
 * Throws `BindingsError` when only one table is present, or when either has a
 * row the template does not describe.
 */
export function parseBindings(markdown: string): FamilyBindings | null {
  const section = envelopeSection(markdown)
  if (section === null) return null

  const parameters = tableRows(section, PARAMETER_HEADER)
  const dependencies = tableRows(section, DEPENDENCY_HEADER)
  if (parameters === null && dependencies === null) return null
  if (parameters === null) {
    throw new BindingsError('§2 lists normative dependencies but binds no core parameters')
  }
  if (dependencies === null) {
    throw new BindingsError('§2 binds core parameters but lists no normative dependencies')
  }
  return { ...parseParameters(parameters), dependencies: parseDependencies(dependencies) }
}

/** `parseBindings` over a family's working-tree spec.md; null when it has none. */
export function readBindings(family: Family): FamilyBindings | null {
  if (!existsSync(family.specPath)) return null
  try {
    return parseBindings(readFileSync(family.specPath, 'utf8'))
  } catch (error) {
    if (error instanceof BindingsError) {
      throw new BindingsError(`${family.name}/${family.major} spec.md §2: ${error.message}`)
    }
    throw error
  }
}
