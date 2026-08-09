/**
 * The document types every phase shares, and the `parser` phase itself.
 *
 * Separate from validator.ts so that semantic.ts can read the component and
 * listing documents an item contains without importing the module that imports
 * it. NON-NORMATIVE, like everything under tools/.
 */
import { isNode, parseDocument as parseYamlDocument, visit } from 'yaml'
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
 * Strict YAML 1.2. Duplicate keys, merge keys, anchors and aliases are all
 * rejected outright — rules JSON Schema cannot express, so they must be
 * enforced before it runs. Component §7 is the clause.
 *
 * `parseDocument` rather than `parse` because it collects every problem instead
 * of throwing on the first, and because its errors carry machine-readable codes.
 * The previous implementation matched on message text, which is exactly the
 * thing this specification declares non-normative.
 */
export function parseDocument(source: string): { value: Json } | { errors: Diagnostic[] } {
  const doc = parseYamlDocument(source, {
    uniqueKeys: true,
    merge: false,
    strict: true,
    version: '1.2',
  })

  const errors: Diagnostic[] = doc.errors.map((error) => ({
    code: error.code === 'DUPLICATE_KEY' ? 'ERR_DUPLICATE_KEY' : 'ERR_INVALID_YAML',
    path: '',
    message: error.message,
  }))

  // An alias expands and an anchor is inert, and both are rejected. The reason
  // is §2's: an author who writes one believes it does something, and a document
  // whose meaning depends on which parser expands it is not one contract.
  //
  // Walked rather than configured because no parser option covers a lone anchor
  // — `maxAliasCount` only ever sees the alias.
  visit(doc, {
    Alias(_key, node) {
      errors.push({
        code: 'ERR_ANCHOR_OR_ALIAS',
        path: '',
        message: `alias *${node.source} is not permitted`,
      })
    },
    Node(_key, node) {
      if (isNode(node) && node.anchor !== undefined) {
        errors.push({
          code: 'ERR_ANCHOR_OR_ALIAS',
          path: '',
          message: `anchor &${node.anchor} is not permitted`,
        })
      }
    },
  })

  if (errors.length > 0) return { errors }
  return { value: doc.toJS() as Json }
}
