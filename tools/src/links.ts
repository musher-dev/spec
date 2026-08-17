/**
 * Every relative link and anchor in the repository's Markdown must resolve.
 *
 * The specifications are held together by cross-references: a family cites
 * another family's clause, a conformance case cites the prose it pins down, an
 * ADR cites the section it refines. `check:conformance` already verifies that a
 * fixture's `clause` resolves, and that check exists because the citation is
 * load-bearing. Every other citation is load-bearing for the same reason and
 * had nothing checking it.
 *
 * The failure this catches is quiet. Renaming a heading or renumbering a
 * section leaves a link that still renders as a link and still looks right in a
 * diff; it just goes nowhere. In a document whose whole job is to be precise
 * about where a rule lives, a citation to a section that no longer exists is
 * worse than no citation.
 *
 * External links are deliberately out of scope. They fail for reasons that have
 * nothing to do with this repository, and a check that goes red because someone
 * else's site is down teaches people to ignore it.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { Failures, REPO_ROOT, relativeToRepo } from './spec.ts'

/** `[text](target)`, skipping image embeds and reference definitions. */
const MARKDOWN_LINK = /\[(?:[^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
/** An explicit anchor: `<a id="envelope"></a>`. */
const EXPLICIT_ANCHOR = /<a id="([^"]+)"><\/a>/g
/** An ATX heading, for GitHub's generated slugs. */
const HEADING = /^#{1,6}\s+(.+?)\s*$/gm

const SKIP_DIRS = new Set(['node_modules', '.git', 'site', '.task'])

function markdownFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(entry)) continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry.endsWith('.md')) found.push(path)
    }
  }
  walk(root)
  return found
}

/**
 * GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens.
 *
 * Approximate by design — it exists so that a link to a heading that carries no
 * explicit anchor still resolves. Every anchor a conformance fixture depends on
 * is explicit, and those are matched exactly.
 */
function headingSlug(text: string): string {
  return text
    .replace(/<a id="[^"]+"><\/a>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

function anchorsIn(source: string): Set<string> {
  const anchors = new Set<string>()
  for (const match of source.matchAll(EXPLICIT_ANCHOR)) {
    if (match[1] !== undefined) anchors.add(match[1])
  }
  for (const match of source.matchAll(HEADING)) {
    if (match[1] !== undefined) anchors.add(headingSlug(match[1]))
  }
  return anchors
}

const anchorCache = new Map<string, Set<string>>()

function anchorsOf(path: string): Set<string> {
  const cached = anchorCache.get(path)
  if (cached !== undefined) return cached
  const anchors = anchorsIn(readFileSync(path, 'utf8'))
  anchorCache.set(path, anchors)
  return anchors
}

function main(): void {
  const failures = new Failures()
  const files = markdownFiles(REPO_ROOT)
  let checked = 0

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const rel = relativeToRepo(file)

    for (const match of source.matchAll(MARKDOWN_LINK)) {
      const target = match[1]
      if (target === undefined) continue

      // Absolute URLs, protocol-relative, and mail links are somebody else's
      // uptime. Bare fragments and repo-relative paths are ours.
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue

      checked += 1
      const [pathPart = '', fragment] = target.split('#') as [string, string?]

      const targetPath = pathPart === '' ? file : resolve(dirname(file), pathPart)
      if (!existsSync(targetPath)) {
        failures.add(`${rel}: link to ${target} — no such file`)
        continue
      }

      if (fragment === undefined || fragment === '') continue
      if (statSync(targetPath).isDirectory()) {
        failures.add(`${rel}: link to ${target} — a directory has no anchors`)
        continue
      }
      if (!targetPath.endsWith('.md')) continue

      if (!anchorsOf(targetPath).has(decodeURIComponent(fragment))) {
        const where = pathPart === '' ? 'this document' : relative(REPO_ROOT, targetPath)
        failures.add(`${rel}: link to ${target} — ${where} has no anchor "${fragment}"`)
      }
    }
  }

  failures.report(`Resolved ${checked} internal link(s) across ${files.length} Markdown file(s).`)
}

if (import.meta.main) main()
