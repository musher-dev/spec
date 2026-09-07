/**
 * The page chrome every generated page shares: escaping, links, the stylesheet,
 * and the document wrapper.
 *
 * It lives here rather than in `site.ts` because `reference.ts` needs it too,
 * and `site.ts` imports `reference.ts` — putting the chrome in `site.ts` would
 * close a cycle.
 *
 * One stylesheet serves every page rather than one per page kind. It is inlined
 * into each document, which keeps a page a single request with no external
 * asset, no font fetch and no `_headers` rule of its own — the same property the
 * schema bundles have, for the same reason. The palette is musher.dev's; the
 * font stacks name Inter and JetBrains Mono first and fall back to the system
 * stack, so a reader who has them gets the product's typography and a reader
 * who does not gets a near-identical face without the page reaching the network.
 *
 * NON-NORMATIVE, like everything under tools/.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
}

const TOKENS = [
  ':root{color-scheme:light dark;',
  '--bg:#fff;--surface:#f6f8fa;--fg:#0b0f14;--muted:#5c5f66;--rule:#d8dee6;--accent:#0b5fff;',
  '--sans:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
  '--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '@media(prefers-color-scheme:dark){:root{',
  '--bg:#0b0f14;--surface:#111820;--fg:#e6eaf0;--muted:#9aa0a6;--rule:#1e2733;--accent:#7aa2ff}}',
].join('')

const BASE = [
  'body{margin:0 auto;max-width:54rem;padding:2.5rem 1.25rem 4rem;background:var(--bg);color:var(--fg);',
  'font:16px/1.6 var(--sans)}',
  'h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1rem;margin:2.5rem 0 .5rem}',
  'h3{font-size:.9375rem;margin:2rem 0 .5rem}p{margin:.5rem 0}',
  '.lead,footer,.muted{color:var(--muted)}',
  'a{color:var(--accent)}',
  'code{font-family:var(--mono);font-size:.875rem}',
  'pre{background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:.75rem 1rem;',
  'overflow-x:auto;font-size:.8125rem}pre code{font-size:inherit}',
  'footer{margin-top:3.5rem;padding-top:1rem;border-top:1px solid var(--rule);font-size:.875rem}',
].join('')

const TABLE = [
  'table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.9375rem}',
  'th,td{border-bottom:1px solid var(--rule);padding:.5rem .6rem;text-align:left;vertical-align:top}',
  'th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}',
  '.hash{color:var(--muted);word-break:break-all;font-size:.8125rem}',
  // A five-column registry table scrolls inside the page rather than widening it.
  '.scroll{overflow-x:auto}',
].join('')

const REFERENCE = [
  '.badge{display:inline-block;font-size:.6875rem;text-transform:uppercase;letter-spacing:.04em;',
  'padding:.05rem .35rem;border:1px solid var(--rule);border-radius:3px;color:var(--muted);',
  'background:var(--surface);margin-right:.25rem}',
  '.badge.req{color:var(--fg);border-color:var(--muted)}',
  '.field{border-top:1px solid var(--rule);padding:.85rem 0}',
  '.field:last-child{border-bottom:1px solid var(--rule)}',
  '.field>.name{font-family:var(--mono);font-weight:600}',
  '.field .meta{color:var(--muted);font-size:.8125rem;margin:.15rem 0 .35rem}',
  'details.note{margin:.4rem 0;font-size:.875rem}',
  'details.note summary{color:var(--muted);cursor:pointer}',
  'details.note div{border-left:2px solid var(--rule);padding-left:.75rem;margin-top:.35rem;color:var(--muted)}',
  '.rules{background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:.75rem 1rem;margin:1rem 0}',
  '.rules p{margin:.35rem 0;font-size:.9375rem}',
  '.toc{font-size:.875rem;columns:2;column-gap:2rem}.toc a{display:block;padding:.1rem 0}',
  // A deep link must visibly land, and the heading must not sit under the edge.
  ':target{background:var(--surface)}',
  'h2,h3,.field{scroll-margin-top:1rem}',
  '@media print{.toc{display:none}details.note{display:block}details.note div{display:block}}',
].join('')

export const STYLE = [TOKENS, BASE, TABLE, REFERENCE].join('')

export function page(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    body,
    '',
  ].join('\n')
}
