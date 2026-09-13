/**
 * Generate the ADR index in `docs/adr/README.md` — `task docs`.
 *
 * The README is a hand-written introduction with a generated table between two
 * markers. The table is read from each ADR's own header: its title, status and
 * date, and its relation bullets condensed onto one line. The last column is
 * computed rather than written — which later ADRs supersede or refine this
 * one — because an accepted ADR's prose is immutable (ADR 0021 §4) and so can
 * never learn what replaced it. Without the back-references a reader of ADR
 * 0001 has no way to find ADR 0023 short of reading every header.
 *
 * The header is parsed with the patterns `policy/adr.ts` checks it against, so
 * a header this renders is one `check:adr` has already accepted.
 *
 * Generated rather than maintained, like `docs/traceability.md`: `task
 * check:docs` fails when the committed table differs from a fresh one.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ADR_DIR, ADR_INDEX_FILE, inRepo, REPO_ROOT, relativeToRepo } from '../lib/layout.ts'
import {
  DATE,
  FILENAME,
  headerLines,
  LINK,
  RELATION,
  SECTION,
  STATUS,
  TITLE,
} from '../policy/adr.ts'

export const INDEX_START = '<!-- adr-index:start -->'
export const INDEX_END = '<!-- adr-index:end -->'

/** A relation's verb, as the back-reference the cited ADR shows for it. */
const BACK_REFERENCE: { readonly [verb: string]: string } = {
  Supersedes: 'Superseded by',
  Refines: 'Refined by',
}

/** `follow-up 2`, cited beside a section. */
const FOLLOW_UP = /follow-up (\d+)/g

/** One relation an ADR header states, condensed. */
export interface Relation {
  readonly verb: string
  /** The cited ADR's file name, or null where the relation names no ADR. */
  readonly file: string | null
  /** `§3`, `follow-up 2`: what of the cited ADR the relation is about. */
  readonly parts: readonly string[]
  /** The relation as written, for one that names no ADR. */
  readonly text: string
}

export interface AdrRecord {
  readonly file: string
  readonly number: string
  readonly title: string
  readonly status: string
  readonly date: string
  readonly relations: readonly Relation[]
}

/** The relations one `- **Verb:** …` bullet states: one per ADR it links. */
function parseRelations(line: string): Relation[] {
  const verb = /^- \*\*([^:]+):\*\*/.exec(line)?.[1] as string
  const rest = line.replace(/^- \*\*[^:]+:\*\*\s*/, '')
  const links = Array.from(rest.matchAll(LINK))
  const relations: Relation[] = []
  links.forEach((link, index) => {
    const file = (link[1] as string).replace(/^\.\//, '').split('#')[0] as string
    if (!FILENAME.test(file)) return
    const start = (link.index ?? 0) + link[0].length
    const end = links[index + 1]?.index ?? rest.length
    const segment = rest.slice(start, end)
    const parts = [
      ...Array.from(segment.matchAll(SECTION), (match) => `§${match[1]}`),
      ...Array.from(segment.matchAll(FOLLOW_UP), (match) => `follow-up ${match[1]}`),
    ]
    relations.push({ verb, file, parts, text: rest })
  })
  if (relations.length === 0) relations.push({ verb, file: null, parts: [], text: rest })
  return relations
}

/** One ADR's header, or null for a file `check:adr` would reject. */
export function parseAdr(file: string, text: string): AdrRecord | null {
  if (!FILENAME.test(file)) return null
  const heading = text.split('\n')[0] ?? ''
  if (!TITLE.test(heading)) return null
  const header = headerLines(text)
  const status = header.find((line) => STATUS.test(line))
  const date = header.find((line) => DATE.test(line))
  if (status === undefined || date === undefined) return null
  return {
    file,
    number: file.slice(0, 4),
    title: heading.replace(/^# ADR \d{4}:\s*/, '').trim(),
    status: status.replace(/^- \*\*Status:\*\*\s*/, '').trim(),
    date: date.replace(/^- \*\*Date:\*\*\s*/, '').trim(),
    relations: header.filter((line) => RELATION.test(line)).flatMap(parseRelations),
  }
}

/** Every ADR in the repository, in number order. */
export function readAdrRecords(repoRoot: string = REPO_ROOT): AdrRecord[] {
  const dir = inRepo(repoRoot, ADR_DIR)
  if (!existsSync(dir)) return []
  const records: AdrRecord[] = []
  for (const name of readdirSync(dir).sort()) {
    const record = parseAdr(name, readFileSync(inRepo(repoRoot, `${ADR_DIR}/${name}`), 'utf8'))
    if (record !== null) records.push(record)
  }
  return records
}

/** A table cell: no pipe may end it early, and no line break may split the row. */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—'
}

function adrLink(file: string): string {
  return `[${file.slice(0, 4)}](${file})`
}

function cited(file: string, parts: readonly string[]): string {
  return parts.length === 0 ? adrLink(file) : `${adrLink(file)} ${parts.join(', ')}`
}

/** The relations column: `Supersedes 0001 §3; Refines 0006 §2`. */
function relationsCell(record: AdrRecord): string {
  return record.relations
    .map((relation) =>
      relation.file === null
        ? `${relation.verb} ${relation.text}`
        : `${relation.verb} ${cited(relation.file, relation.parts)}`,
    )
    .join('; ')
}

/**
 * Target file name to the back-references it receives, grouped by verb in
 * `BACK_REFERENCE` order and by citing ADR number within a verb.
 */
export function backReferences(records: readonly AdrRecord[]): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const [verb, backVerb] of Object.entries(BACK_REFERENCE)) {
    for (const record of records) {
      for (const relation of record.relations) {
        if (relation.verb !== verb || relation.file === null) continue
        const entry = `${backVerb} ${cited(record.file, relation.parts)}`
        found.set(relation.file, [...(found.get(relation.file) ?? []), entry])
      }
    }
  }
  return found
}

/** The generated table, markers excluded. */
export function buildAdrTable(records: readonly AdrRecord[]): string {
  const back = backReferences(records)
  const lines = [
    '<!-- Generated by `task docs` from each ADR header. Do not edit by hand. -->',
    '',
    '| ADR | Title | Status | Date | Relations | Superseded / refined by |',
    '|---|---|---|---|---|---|',
  ]
  for (const record of records) {
    const row = [
      adrLink(record.file),
      record.title,
      record.status,
      record.date,
      relationsCell(record),
      (back.get(record.file) ?? []).join('; '),
    ]
    lines.push(`| ${row.map(cell).join(' | ')} |`)
  }
  return lines.join('\n')
}

/** `readme` with everything between the markers replaced by `table`. */
export function spliceIndex(readme: string, table: string, path = ADR_INDEX_FILE): string {
  const start = readme.indexOf(INDEX_START)
  const end = readme.indexOf(INDEX_END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${path} must carry ${INDEX_START} and then ${INDEX_END} around the index.`)
  }
  return `${readme.slice(0, start + INDEX_START.length)}\n\n${table}\n\n${readme.slice(end)}`
}

/** What `docs/adr/README.md` should hold: its own introduction, and a fresh table. */
export function buildAdrIndex(repoRoot: string = REPO_ROOT): string {
  const path = inRepo(repoRoot, ADR_INDEX_FILE)
  if (!existsSync(path)) {
    throw new Error(
      `${ADR_INDEX_FILE} does not exist; it holds the introduction the index sits in.`,
    )
  }
  return spliceIndex(readFileSync(path, 'utf8'), buildAdrTable(readAdrRecords(repoRoot)))
}

function main(): void {
  const output = inRepo(REPO_ROOT, ADR_INDEX_FILE)
  writeFileSync(output, buildAdrIndex(), 'utf8')
  console.log(`  ✓ ${relativeToRepo(output)}`)
}

if (import.meta.main) main()
