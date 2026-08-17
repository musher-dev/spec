/**
 * The document types every phase shares, and the `parser` phase itself.
 *
 * Separate from validator.ts so that semantic.ts can read the component and
 * listing documents an item contains without importing the module that imports
 * it. NON-NORMATIVE, like everything under tools/.
 */
import { isNode, isPair, isScalar, parseAllDocuments, visit } from 'yaml'
import type { Json } from './spec.ts'

export type Phase = 'parser' | 'structural' | 'semantic' | 'capability'

export interface Diagnostic {
  /** Normative. Implementations map their internal errors onto these. */
  readonly code: string
  /** Normative. JSON Pointer into the document, `` for the root. */
  readonly path: string
  /** Non-normative — text differs between implementations by design. */
  readonly message: string
}

/**
 * The bounds component §7.1 states. They are part of the contract rather than
 * an implementation detail: a document one validator accepts and another
 * refuses on size is not one contract, and "be sensible" is not a bound.
 *
 * All three are far above any document a person would write and far below what
 * makes a parser a denial-of-service surface.
 */
export const MAX_DOCUMENT_BYTES = 1024 * 1024
export const MAX_SCALAR_BYTES = 64 * 1024
export const MAX_DEPTH = 64

const UTF8_BOM = '﻿'

function diagnostic(code: string, message: string): Diagnostic {
  return { code, path: '', message }
}

/**
 * Strict YAML 1.2, restricted further by the Musher document profile.
 *
 * Component §7.1 is the clause. Everything rejected here is well-formed YAML
 * that this contract withholds, and the reason is always the same one: a
 * document whose meaning depends on which parser reads it, or on how much work
 * a reader is willing to do before deciding, is not a contract.
 *
 * `parseAllDocuments` rather than `parseDocument` because a stream carrying two
 * documents must be seen as two rather than silently reduced to the first, and
 * because its errors carry machine-readable codes — the previous implementation
 * matched on message text, which is exactly what this specification declares
 * non-normative.
 */
export function parseDocument(source: string): { value: Json } | { errors: Diagnostic[] } {
  const errors: Diagnostic[] = []

  // Size is measured before parsing. A bound a parser can only apply after
  // building the tree is not a bound on the work it does.
  const bytes = Buffer.byteLength(source, 'utf8')
  if (bytes > MAX_DOCUMENT_BYTES) {
    return {
      errors: [
        diagnostic(
          'ERR_DOCUMENT_TOO_LARGE',
          `document is ${bytes} bytes, over the ${MAX_DOCUMENT_BYTES}-byte limit`,
        ),
      ],
    }
  }

  // A BOM is permitted and carries no meaning. Rejecting one would fail
  // documents whose only fault is the editor that saved them.
  const text = source.startsWith(UTF8_BOM) ? source.slice(UTF8_BOM.length) : source

  const documents = parseAllDocuments(text, {
    uniqueKeys: true,
    merge: false,
    strict: true,
    version: '1.2',
  })

  if (documents.length > 1) {
    errors.push(
      diagnostic(
        'ERR_MULTIPLE_DOCUMENTS',
        `${documents.length} documents in one file; exactly one is permitted`,
      ),
    )
  }

  const first = documents[0]
  if (first === undefined) {
    return { errors: [diagnostic('ERR_INVALID_YAML', 'document is empty')] }
  }

  for (const error of first.errors) {
    errors.push(
      diagnostic(
        error.code === 'DUPLICATE_KEY' ? 'ERR_DUPLICATE_KEY' : 'ERR_INVALID_YAML',
        error.message,
      ),
    )
  }

  visit(first, {
    // An alias expands and an anchor is inert, and both are rejected. The
    // reason is §2's: an author who writes one believes it does something, and
    // a document whose meaning depends on which parser expands it is not one
    // contract.
    //
    // Walked rather than configured because no parser option covers a lone
    // anchor — `maxAliasCount` only ever sees the alias.
    Alias(_key, node) {
      errors.push(diagnostic('ERR_ANCHOR_OR_ALIAS', `alias *${node.source} is not permitted`))
    },
    Node(_key, node) {
      if (!isNode(node)) return
      if (node.anchor !== undefined) {
        errors.push(diagnostic('ERR_ANCHOR_OR_ALIAS', `anchor &${node.anchor} is not permitted`))
      }
      // Any explicit tag, including a core-schema one like `!!str`. Scalars
      // resolve by the YAML 1.2 core schema and nothing else; a tag is a way
      // to override that resolution, which is the thing being withheld.
      if (node.tag !== undefined && node.tag !== null) {
        errors.push(diagnostic('ERR_EXPLICIT_TAG', `explicit tag ${node.tag} is not permitted`))
      }
      if (isScalar(node) && typeof node.value === 'string') {
        const length = Buffer.byteLength(node.value, 'utf8')
        if (length > MAX_SCALAR_BYTES) {
          errors.push(
            diagnostic(
              'ERR_SCALAR_TOO_LONG',
              `scalar is ${length} bytes, over the ${MAX_SCALAR_BYTES}-byte limit`,
            ),
          )
        }
      }
    },
    Pair(_key, pair) {
      if (!isPair(pair) || !isScalar(pair.key)) return
      const key = pair.key.value
      // `merge: false` leaves `<<` as an ordinary key rather than expanding it,
      // so without this it would surface as an unknown field two phases later
      // and describe the wrong problem.
      if (key === '<<') {
        errors.push(diagnostic('ERR_MERGE_KEY', 'merge key << is not permitted'))
        return
      }
      if (typeof key !== 'string') {
        errors.push(
          diagnostic('ERR_NON_STRING_KEY', `mapping key ${JSON.stringify(key)} is not a string`),
        )
      }
    },
  })

  const depth = maxDepth(first.toJS() as Json)
  if (depth > MAX_DEPTH) {
    errors.push(
      diagnostic('ERR_DEPTH_EXCEEDED', `document nests ${depth} deep, over the ${MAX_DEPTH} limit`),
    )
  }

  if (errors.length > 0) return { errors }
  return { value: first.toJS() as Json }
}

/** Deepest nesting level in a parsed value. A scalar is depth 0. */
function maxDepth(value: Json, depth = 0): number {
  // Guard the walk itself: a document already past the limit must not be
  // measured by unbounded recursion.
  if (depth > MAX_DEPTH) return depth
  if (Array.isArray(value)) {
    let deepest = depth
    for (const item of value) deepest = Math.max(deepest, maxDepth(item, depth + 1))
    return deepest
  }
  if (typeof value === 'object' && value !== null) {
    let deepest = depth
    for (const item of Object.values(value)) deepest = Math.max(deepest, maxDepth(item, depth + 1))
    return deepest
  }
  return depth
}
