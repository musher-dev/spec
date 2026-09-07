/**
 * A schema bundle, read into the shape a reader needs rather than the shape a
 * validator needs.
 *
 * This module is pure: JSON in, model out, no filesystem, no git, no HTML. That
 * is what lets the hard part — deciding what a construct *means* — be tested
 * without parsing markup, and it is where the correctness guarantees live.
 *
 * The governing rule is that nothing is ever silently simplified. A generic
 * renderer flattens what it does not understand into an anonymous `oneOf` tree
 * and an `additionalProperties` blob, and the reader cannot tell the difference
 * between a rule that is absent and a rule that was dropped. So every construct
 * this repository actually uses has a case here, and a construct that does not
 * throws by name and pointer. A new keyword entering the contract fails the site
 * build; it does not ship a page that quietly omits a rule.
 *
 * Two custom annotations are the reason a bespoke reader is better here than any
 * general tool, and both are rendering hints that assert nothing:
 * `x-musher-discriminator` names which `oneOf` branch to expect, and
 * `x-additionalPropertiesName` names the key of a map whose keys the document
 * author chooses. `lint.ts` allowlists exactly these two.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import { escapeHtml, link } from './html.ts'
import { type ProseContext, renderInline } from './prose.ts'
import { isObject, type Json } from './spec.ts'

/** Constraints worth showing beside a field. Ordered as they are rendered. */
const CONSTRAINT_KEYS = [
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
] as const

/**
 * Keywords a schema node may carry that this reader accounts for.
 *
 * Anything outside this set throws. The list is deliberately explicit rather
 * than a wildcard: `format`, `examples`, `deprecated`, `patternProperties`,
 * `prefixItems`, `unevaluatedProperties`, `$anchor` and `dependentSchemas` are
 * all absent from every bundle today, and the day one appears is the day this
 * reader needs a decision about it.
 */
const KNOWN_KEYS = new Set<string>([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  '$comment',
  'title',
  'description',
  'default',
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'items',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'x-musher-discriminator',
  'x-additionalPropertiesName',
  ...CONSTRAINT_KEYS,
])

export interface Constraint {
  readonly name: string
  readonly value: Json
}

export interface Branch {
  readonly label: string | undefined
  readonly target: string
}

export interface Discriminator {
  readonly propertyName: string
  readonly branches: readonly Branch[]
}

export type Shape =
  | { readonly kind: 'scalar'; readonly type: string }
  | { readonly kind: 'enum'; readonly type: string | undefined; readonly values: readonly Json[] }
  | { readonly kind: 'const'; readonly type: string | undefined; readonly value: Json }
  | { readonly kind: 'ref'; readonly target: string }
  | { readonly kind: 'array'; readonly items: Shape }
  | {
      readonly kind: 'map'
      readonly keyName: string
      /** Whether the key name was annotated or fallen back to. */
      readonly named: boolean
      readonly keyPattern: string | undefined
      readonly value: Shape
    }
  | {
      readonly kind: 'union'
      readonly discriminator: Discriminator | undefined
      readonly branches: readonly Shape[]
    }
  /** A genuine two-form alternation with no null branch, e.g. two patterns. */
  | { readonly kind: 'alternation'; readonly branches: readonly Shape[] }
  /** The `false` subschema: present in no valid document. */
  | { readonly kind: 'forbidden' }
  /**
   * A node with no type of its own. It may still assert: the two branches of
   * `BlueprintNode.component` are bare `pattern`s, and they are the entire
   * difference between the two forms — dropping them would render the field as
   * "any value, or any value".
   */
  | { readonly kind: 'any'; readonly constraints: readonly Constraint[] }

export interface FieldDoc {
  readonly name: string
  readonly anchor: string
  readonly required: boolean
  readonly nullable: boolean
  readonly shape: Shape
  readonly description: string | undefined
  readonly comment: string | undefined
  /** Present iff the schema annotates one. `null` is a value, not an absence. */
  readonly documented: { readonly value: Json } | undefined
  readonly constraints: readonly Constraint[]
}

export type Predicate =
  | { readonly kind: 'const'; readonly field: string; readonly value: Json }
  | { readonly kind: 'enum'; readonly field: string; readonly values: readonly Json[] }
  | { readonly kind: 'pattern'; readonly field: string; readonly pattern: string }
  | { readonly kind: 'notConst'; readonly field: string; readonly value: Json }
  | { readonly kind: 'all'; readonly of: readonly Predicate[] }
  /** A condition no mechanical phrasing does justice to; its `$comment` carries it. */
  | { readonly kind: 'opaque' }

export interface Effect {
  readonly field: string
  readonly detail: string
}

export interface ConditionDoc {
  readonly pointer: string
  readonly when: Predicate
  /** What the condition imposes when it holds, and when it does not. */
  readonly consequent: readonly Effect[]
  readonly alternative: readonly Effect[]
  readonly comment: string | undefined
}

export interface TypeDoc {
  readonly name: string
  readonly anchor: string
  readonly description: string | undefined
  readonly comment: string | undefined
  /** `x-additionalPropertiesName` on this type: what its key is called. */
  readonly keyName: string | undefined
  readonly closed: boolean
  readonly fields: readonly FieldDoc[]
  readonly conditions: readonly ConditionDoc[]
}

export interface ReferenceModel {
  readonly family: string
  readonly version: string
  readonly title: string
  readonly description: string | undefined
  readonly comment: string | undefined
  readonly root: TypeDoc
  readonly types: readonly TypeDoc[]
  /** Observations worth printing but not worth failing on. */
  readonly notes: readonly string[]
}

/** The root type's name. The bundle root has a `title` but no `$defs` key. */
const ROOT = 'Document'

class Builder {
  private readonly defs: { [k: string]: Json }
  readonly notes: string[] = []

  constructor(
    private readonly bundle: { [k: string]: Json },
    private readonly where: string,
  ) {
    const defs = bundle.$defs
    this.defs = isObject(defs) ? defs : {}
  }

  private fail(pointer: string, message: string): never {
    throw new Error(`${this.where}: ${pointer || '<root>'} ${message}`)
  }

  /** Every keyword must be one this reader has a decision about. */
  private assertKnown(node: { [k: string]: Json }, pointer: string): void {
    for (const key of Object.keys(node)) {
      if (KNOWN_KEYS.has(key)) continue
      this.fail(
        pointer,
        `declares "${key}", which this reference reader has no case for. Add one ` +
          'rather than letting the page omit whatever it means.',
      )
    }
  }

  private refTarget(node: { [k: string]: Json }, pointer: string): string | undefined {
    const ref = node.$ref
    if (typeof ref !== 'string') return undefined
    if (!ref.startsWith('#/$defs/')) this.fail(pointer, `has a non-local $ref — ${ref}`)
    const name = ref.slice('#/$defs/'.length)
    if (this.defs[name] === undefined) this.fail(pointer, `$ref names a missing $defs/${name}`)
    return name
  }

  private constraintsOf(node: { [k: string]: Json }): Constraint[] {
    const out: Constraint[] = []
    for (const name of CONSTRAINT_KEYS) {
      if (name in node) out.push({ name, value: node[name] as Json })
    }
    return out
  }

  /**
   * A map is an object whose keys the document author chooses.
   *
   * `additionalProperties` carrying a schema is necessary but not sufficient:
   * `ComponentWorkload/allOf/4/if/properties/endpoints/not` carries one too, and
   * it is the "no member matches" negation rather than a map. That node declares
   * no `type`, so requiring `type: "object"` on the enclosing schema separates
   * the two — and the caller additionally never asks about a node inside a
   * condition.
   */
  private isMap(node: { [k: string]: Json }): boolean {
    return node.type === 'object' && isObject(node.additionalProperties)
  }

  /**
   * What a map's keys are called.
   *
   * Two placements, most specific first. The annotation usually sits on the
   * `$def` that is the map's value type, which is where six of the seven are;
   * but a map whose value is an inline scalar — `ComponentBuild.arguments` — has
   * no definition to carry it, so the map itself may name its key instead.
   */
  private keyNameOf(node: { [k: string]: Json }, value: Shape): string | undefined {
    const here = node['x-additionalPropertiesName']
    if (typeof here === 'string') return here
    if (value.kind !== 'ref') return undefined
    const target = this.defs[value.target]
    if (!isObject(target)) return undefined
    const name = target['x-additionalPropertiesName']
    return typeof name === 'string' ? name : undefined
  }

  private discriminatorOf(node: { [k: string]: Json }, pointer: string): Discriminator | undefined {
    const raw = node['x-musher-discriminator']
    if (!isObject(raw)) return undefined
    const propertyName = raw.propertyName
    const mapping = raw.mapping
    if (typeof propertyName !== 'string' || !isObject(mapping)) {
      this.fail(pointer, 'has an x-musher-discriminator without a propertyName and mapping')
    }
    // Resolved by pointer and sorted by value. The mapping's keys are
    // alphabetical after canonicalization while `oneOf` keeps its authored
    // order, and for ComponentEnvVar.value the two genuinely disagree — zipping
    // them positionally would label each branch with the other's name.
    const branches: Branch[] = []
    for (const label of Object.keys(mapping).sort()) {
      const target: Json = mapping[label] as Json
      if (typeof target !== 'string' || !target.startsWith('#/$defs/')) {
        this.fail(pointer, `has a discriminator mapping for ${label} that is not a local pointer`)
      }
      const name = target.slice('#/$defs/'.length)
      if (this.defs[name] === undefined) {
        this.fail(
          pointer,
          `has a discriminator mapping for ${label} naming a missing $defs/${name}`,
        )
      }
      branches.push({ label, target: name })
    }
    return { propertyName, branches }
  }

  /**
   * Read one schema node's shape.
   *
   * `nullable` is decided by the presence of a `{"type": "null"}` branch, never
   * by branch count: 44 of the 45 `anyOf`s in the bundles are that idiom, and
   * the one that is not — `BlueprintNode.component` — has two live branches and
   * would be mislabelled by any arity rule.
   */
  shapeOf(raw: Json, pointer: string): { shape: Shape; nullable: boolean } {
    if (raw === false) return { shape: { kind: 'forbidden' }, nullable: false }
    if (raw === true) return { shape: { kind: 'any', constraints: [] }, nullable: false }
    if (!isObject(raw)) this.fail(pointer, `is ${JSON.stringify(raw)}, which is not a schema`)

    const node = raw
    this.assertKnown(node, pointer)

    for (const key of ['anyOf', 'oneOf'] as const) {
      const branches = node[key]
      if (!Array.isArray(branches)) continue
      const live: Json[] = []
      let nullable = false
      for (const branch of branches) {
        if (isObject(branch) && branch.type === 'null' && Object.keys(branch).length === 1) {
          nullable = true
          continue
        }
        live.push(branch as Json)
      }
      const shapes = live.map((branch, i) => this.shapeOf(branch, `${pointer}/${key}/${i}`).shape)
      if (shapes.length === 0) return { shape: { kind: 'scalar', type: 'null' }, nullable: true }
      if (shapes.length === 1 && key === 'anyOf') {
        const only = shapes[0]
        if (only === undefined) this.fail(pointer, 'has an empty branch list')
        // Sibling assertions sit outside the anyOf and still apply; a caller
        // reads them from the node, so only the shape collapses here.
        return { shape: only, nullable }
      }
      const discriminator = this.discriminatorOf(node, pointer)
      return {
        shape:
          key === 'oneOf' || discriminator !== undefined
            ? { kind: 'union', discriminator, branches: shapes }
            : { kind: 'alternation', branches: shapes },
        nullable,
      }
    }

    const target = this.refTarget(node, pointer)
    if (target !== undefined) return { shape: { kind: 'ref', target }, nullable: false }

    if (this.isMap(node)) {
      const value = this.shapeOf(
        node.additionalProperties as Json,
        `${pointer}/additionalProperties`,
      )
      const annotated = this.keyNameOf(node, value.shape)
      if (annotated === undefined) {
        this.notes.push(
          `${pointer}: map key unnamed — its value type carries no x-additionalPropertiesName`,
        )
      }
      const names = node.propertyNames
      const keyPattern =
        isObject(names) && typeof names.pattern === 'string' ? names.pattern : undefined
      return {
        shape: {
          kind: 'map',
          keyName: annotated ?? 'name',
          named: annotated !== undefined,
          keyPattern,
          value: value.shape,
        },
        nullable: false,
      }
    }

    if (node.items !== undefined) {
      const items = this.shapeOf(node.items as Json, `${pointer}/items`)
      return { shape: { kind: 'array', items: items.shape }, nullable: false }
    }

    const type = typeof node.type === 'string' ? node.type : undefined
    if (Array.isArray(node.type)) {
      this.fail(pointer, 'declares an array "type", which no Musher schema uses — add a case')
    }
    // `KNOWN_KEYS` gates the *name* of a keyword. These four are named there
    // because they are legitimate inside a conditional, where `predicateOf`
    // and `effectsOf` read them — but in shape position this reader has no
    // case for any of them, and returning a bare `object` or `any` would drop
    // a type, a nested field set, or a negation without a word. Refuse instead.
    for (const unhandled of ['allOf', 'not', 'if', 'properties'] as const) {
      if (node[unhandled] !== undefined) {
        this.fail(
          pointer,
          `carries "${unhandled}" where a shape is expected. No Musher schema does this ` +
            'today; add a case rather than letting the page render it as an untyped value.',
        )
      }
    }
    if ('const' in node) {
      return { shape: { kind: 'const', type, value: node.const as Json }, nullable: false }
    }
    if (Array.isArray(node.enum)) {
      // Every member, whatever its type, and the declared type as declared.
      // Filtering to strings would delete a numeric or null member from the
      // page silently; defaulting the type to `string` would label an untyped
      // enum as something the schema never said.
      return { shape: { kind: 'enum', type, values: node.enum as Json[] }, nullable: false }
    }
    if (type !== undefined) return { shape: { kind: 'scalar', type }, nullable: false }
    return { shape: { kind: 'any', constraints: this.constraintsOf(node) }, nullable: false }
  }

  /** One `if` read as a statement about a field, or `opaque` where it is not. */
  private predicateOf(raw: Json): Predicate {
    if (!isObject(raw) || !isObject(raw.properties)) return { kind: 'opaque' }
    const parts: Predicate[] = []
    for (const field of Object.keys(raw.properties).sort()) {
      const test = (raw.properties as { [k: string]: Json })[field]
      if (!isObject(test)) return { kind: 'opaque' }
      if ('const' in test) parts.push({ kind: 'const', field, value: test.const as Json })
      else if (Array.isArray(test.enum))
        parts.push({ kind: 'enum', field, values: test.enum as Json[] })
      else if (typeof test.pattern === 'string')
        parts.push({ kind: 'pattern', field, pattern: test.pattern })
      else if (isObject(test.not) && 'const' in test.not) {
        parts.push({ kind: 'notConst', field, value: test.not.const as Json })
      } else return { kind: 'opaque' }
    }
    if (parts.length === 0) return { kind: 'opaque' }
    const only = parts[0]
    if (parts.length === 1 && only !== undefined) return only
    return { kind: 'all', of: parts }
  }

  /**
   * What a `then` or `else` does to the fields it names.
   *
   * Rendered as a sentence rather than a shape, because a narrowing is a rule
   * about a field the type already documents. An effect this reader cannot
   * phrase falls back to naming the keywords rather than throwing: a condition
   * is explanatory, and losing the phrasing costs a sentence, where losing a
   * *shape* would cost a rule.
   */
  private effectsOf(raw: Json): Effect[] {
    if (!isObject(raw)) return []
    const out: Effect[] = []
    const required = new Set(
      Array.isArray(raw.required)
        ? raw.required.filter((r): r is string => typeof r === 'string')
        : [],
    )
    if (isObject(raw.properties)) {
      for (const field of Object.keys(raw.properties).sort()) {
        const rule = (raw.properties as { [k: string]: Json })[field]
        out.push({ field, detail: this.phrase(rule as Json, required.has(field)) })
        required.delete(field)
      }
    }
    for (const field of [...required].sort()) out.push({ field, detail: 'is required' })
    return out
  }

  private phrase(rule: Json, required: boolean): string {
    const clauses: string[] = []
    if (required) clauses.push('is required')
    clauses.push(...this.rulePhrase(rule))
    return clauses.length === 0 ? 'is constrained' : clauses.join(' and ')
  }

  private rulePhrase(rule: Json): string[] {
    if (rule === false) return ['must not be present']
    if (!isObject(rule)) return []
    if (rule.type === 'null') return ['must be null']
    if (rule.maxProperties === 0 || rule.maxItems === 0) return ['must be empty']
    if (rule.minProperties === 1 || rule.minItems === 1) return ['must not be empty']
    if ('const' in rule) return [`must be ${JSON.stringify(rule.const)}`]
    if (typeof rule.$ref === 'string') {
      const name = rule.$ref.slice('#/$defs/'.length)
      const adds = Array.isArray(rule.required)
        ? rule.required.filter((r): r is string => typeof r === 'string')
        : []
      // The $ref-with-siblings case. Rendering only the $ref drops the added
      // requirement; rendering only `required` drops the type. Both or neither.
      const narrowed =
        adds.length > 0 ? `, with ${adds.map((a) => `\`${a}\``).join(', ')} required` : ''
      return [`is a ${name}${narrowed}`]
    }
    const keys = Object.keys(rule).filter((k) => k !== '$comment' && k !== 'description')
    return keys.length === 0 ? [] : [`is constrained by ${keys.sort().join(', ')}`]
  }

  private conditionsOf(node: { [k: string]: Json }, pointer: string): ConditionDoc[] {
    const out: ConditionDoc[] = []
    const add = (source: { [k: string]: Json }, at: string): void => {
      if (source.if === undefined) return
      out.push({
        pointer: at,
        when: this.predicateOf(source.if as Json),
        consequent: this.effectsOf(source.then as Json),
        alternative: this.effectsOf(source.else as Json),
        comment: typeof source.$comment === 'string' ? source.$comment : undefined,
      })
    }
    add(node, pointer)
    if (Array.isArray(node.allOf)) {
      node.allOf.forEach((branch, i) => {
        if (isObject(branch)) add(branch, `${pointer}/allOf/${i}`)
      })
    }
    return out
  }

  typeOf(raw: Json, name: string, pointer: string): TypeDoc {
    if (!isObject(raw)) this.fail(pointer, 'is not an object schema')
    const node = raw
    this.assertKnown(node, pointer)

    const properties = isObject(node.properties) ? node.properties : {}
    const required = new Set(
      Array.isArray(node.required)
        ? node.required.filter((r): r is string => typeof r === 'string')
        : [],
    )

    const fields: FieldDoc[] = []
    for (const field of Object.keys(properties).sort()) {
      const at = `${pointer}/properties/${field}`
      const child = (properties as { [k: string]: Json })[field] as Json
      const { shape, nullable } = this.shapeOf(child, at)
      const carrier = isObject(child) ? child : {}
      fields.push({
        name: field,
        anchor: `${name}.${field}`,
        required: required.has(field),
        nullable,
        shape,
        description: typeof carrier.description === 'string' ? carrier.description : undefined,
        comment: typeof carrier.$comment === 'string' ? carrier.$comment : undefined,
        documented: 'default' in carrier ? { value: carrier.default as Json } : undefined,
        constraints: this.constraintsOf(carrier),
      })
    }

    return {
      name,
      anchor: name,
      description: typeof node.description === 'string' ? node.description : undefined,
      comment: typeof node.$comment === 'string' ? node.$comment : undefined,
      keyName:
        typeof node['x-additionalPropertiesName'] === 'string'
          ? (node['x-additionalPropertiesName'] as string)
          : undefined,
      closed: node.additionalProperties === false,
      fields,
      conditions: this.conditionsOf(node, pointer),
    }
  }

  build(family: string, version: string): ReferenceModel {
    const title =
      typeof this.bundle.title === 'string' ? this.bundle.title : `Musher ${family} document`
    const types = Object.keys(this.defs)
      .sort()
      .map((name) => this.typeOf(this.defs[name] as Json, name, `/$defs/${name}`))

    const root = this.typeOf(this.bundle, ROOT, '')
    const anchors = new Set<string>()
    for (const type of [...types, root]) {
      for (const anchor of [type.anchor, ...type.fields.map((f) => f.anchor)]) {
        if (anchors.has(anchor)) this.fail('', `produces the anchor ${anchor} twice`)
        anchors.add(anchor)
      }
    }

    return {
      family,
      version,
      title,
      description:
        typeof this.bundle.description === 'string' ? this.bundle.description : undefined,
      comment: typeof this.bundle.$comment === 'string' ? this.bundle.$comment : undefined,
      root,
      types,
      notes: this.notes,
    }
  }
}

/**
 * Read a bundle into its reference model.
 *
 * Total on a bundle carrying no `$defs` and no `properties` — the shape the test
 * fixture writes — so adding a reference page cannot break the publication tests
 * that predate it.
 */
export function buildReference(bundle: Json, family: string, version: string): ReferenceModel {
  if (!isObject(bundle)) throw new Error(`${family}/${version}: bundle is not an object`)
  return new Builder(bundle, `${family}/${version}`).build(family, version)
}

// ===== Rendering =====================================================
//
// The model above decides what a construct means. Everything below decides
// only how to say it, and may be changed without touching a guarantee.

export interface PageContext {
  /** Where this family's bundle is served, for the "get the schema" action. */
  readonly schemaPath: string
  /** Where the rendered prose is, or null when the ref carries no spec.md. */
  readonly prosePath: string | null
  /** Where the validated examples are, or null when the ref carries none. */
  readonly examplesPath: string | null
  /** The GitHub blob of the prose, at the ref being described. */
  readonly sourceUrl: string
  readonly links: ProseContext | null
}

function prose(text: string | undefined, context: PageContext): string {
  return text === undefined ? '' : renderInline(text, context.links)
}

/** An informative aside: rationale the schema author wrote for a reader. */
function note(comment: string | undefined, context: PageContext, summary: string): string {
  if (comment === undefined) return ''
  return `<details class="note"><summary>${escapeHtml(summary)}</summary><div>${prose(comment, context)}</div></details>`
}

/** A schema value as a reader sees it: a string as itself, anything else as JSON. */
function literal(value: Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function typeLink(name: string): string {
  return `<a href="#${encodeURIComponent(name)}"><code>${escapeHtml(name)}</code></a>`
}

/** One shape as a phrase, with every nested type linked rather than inlined. */
function describeShape(shape: Shape): string {
  switch (shape.kind) {
    case 'scalar':
      return escapeHtml(shape.type)
    case 'enum': {
      const members = shape.values.map((v) => `<code>${escapeHtml(literal(v))}</code>`).join(', ')
      return shape.type === undefined
        ? `one of ${members}`
        : `${escapeHtml(shape.type)} — one of ${members}`
    }
    case 'const': {
      const value = `<code>${escapeHtml(literal(shape.value))}</code>`
      return shape.type === undefined
        ? `always ${value}`
        : `${escapeHtml(shape.type)} — always ${value}`
    }
    case 'ref':
      return typeLink(shape.target)
    case 'array':
      return `array of ${describeShape(shape.items)}`
    case 'map': {
      const key = `<code>${escapeHtml(shape.keyName)}</code>`
      const grammar =
        shape.keyPattern === undefined
          ? ''
          : ` matching <code>${escapeHtml(shape.keyPattern)}</code>`
      return `mapping, keyed by ${key}${grammar}, to ${describeShape(shape.value)}`
    }
    case 'union':
      return shape.discriminator === undefined
        ? `one of ${shape.branches.map(describeShape).join(', ')}`
        : `one of, by <code>${escapeHtml(shape.discriminator.propertyName)}</code>: ${shape.discriminator.branches
            .map((b) => `<code>${escapeHtml(b.label ?? '')}</code> → ${typeLink(b.target)}`)
            .join(', ')}`
    case 'alternation':
      return `one of ${shape.branches.length} forms: ${shape.branches.map(describeShape).join(', or ')}`
    case 'forbidden':
      return 'must not be present'
    case 'any': {
      if (shape.constraints.length === 0) return 'any value'
      return shape.constraints
        .map((c) => `${escapeHtml(c.name)} <code>${escapeHtml(String(c.value))}</code>`)
        .join(', ')
    }
  }
}

function renderConstraints(field: FieldDoc): string {
  const parts = field.constraints.map(
    (c) => `${escapeHtml(c.name)} <code>${escapeHtml(JSON.stringify(c.value))}</code>`,
  )
  // `default` is an annotation. Saying "default" unqualified would claim a
  // validator inserts it, and none does; see ADR 0008.
  if (field.documented !== undefined) {
    parts.push(
      field.documented.value === null
        ? 'absent means <code>null</code>'
        : `documented default <code>${escapeHtml(JSON.stringify(field.documented.value))}</code>`,
    )
  }
  return parts.length === 0 ? '' : `<p class="meta">${parts.join(' · ')}</p>`
}

function renderField(field: FieldDoc, context: PageContext): string {
  const badges = [
    field.required
      ? '<span class="badge req">required</span>'
      : '<span class="badge">optional</span>',
    field.nullable ? '<span class="badge">nullable</span>' : '',
  ].join('')
  return [
    `<div class="field" id="${escapeHtml(field.anchor)}">`,
    `<div class="name">${escapeHtml(field.name)} ${badges}</div>`,
    `<p class="meta">${describeShape(field.shape)}</p>`,
    prose(field.description, context),
    renderConstraints(field),
    note(field.comment, context, 'Authoring note'),
    '</div>',
  ]
    .filter((part) => part !== '')
    .join('\n')
}

function renderConditions(type: TypeDoc, context: PageContext): string {
  if (type.conditions.length === 0) return ''
  const rows = type.conditions.map((condition) => {
    const when = phraseWhen(condition.when)
    const lines = [
      ...condition.consequent.map(
        (e) => `<p>${when}, <code>${escapeHtml(e.field)}</code> ${detail(e, context)}.</p>`,
      ),
      ...condition.alternative.map(
        (e) => `<p>Otherwise, <code>${escapeHtml(e.field)}</code> ${detail(e, context)}.</p>`,
      ),
    ]
    // Where the condition resists phrasing, its authored rationale is the only
    // readable form of the rule, so it is shown rather than hidden.
    if (condition.when.kind === 'opaque' && condition.comment !== undefined) {
      lines.unshift(`<p class="muted">${prose(condition.comment, context)}</p>`)
    }
    return lines.join('\n')
  })
  return `<div class="rules"><p class="meta">Conditional rules</p>\n${rows.join('\n')}</div>`
}

/**
 * An effect's phrasing, as prose.
 *
 * `rulePhrase` writes field names in backticks because that is how this
 * repository writes a field name. Escaping the string would print the
 * backticks; rendering it as CommonMark turns them into `<code>`.
 */
function detail(effect: Effect, context: PageContext): string {
  return renderInline(effect.detail, context.links)
    .trim()
    .replace(/^<p>/, '')
    .replace(/<\/p>$/, '')
}

function phraseWhen(predicate: Predicate): string {
  switch (predicate.kind) {
    case 'const':
      return `When <code>${escapeHtml(predicate.field)}</code> is <code>${escapeHtml(String(predicate.value))}</code>`
    case 'enum':
      return `When <code>${escapeHtml(predicate.field)}</code> is ${predicate.values
        .map((v) => `<code>${escapeHtml(String(v))}</code>`)
        .join(' or ')}`
    case 'pattern':
      return `When <code>${escapeHtml(predicate.field)}</code> matches <code>${escapeHtml(predicate.pattern)}</code>`
    case 'notConst':
      return `When <code>${escapeHtml(predicate.field)}</code> is not <code>${escapeHtml(String(predicate.value))}</code>`
    case 'all':
      return predicate.of
        .map(phraseWhen)
        .join(', and ')
        .replace(/, and When /g, ' and ')
    case 'opaque':
      return 'Under the condition above'
  }
}

function renderType(type: TypeDoc, context: PageContext, heading: string): string {
  const key =
    type.keyName === undefined
      ? ''
      : `<p class="meta">Used as a map value, keyed by <code>${escapeHtml(type.keyName)}</code>.</p>`
  return [
    `<h2 id="${escapeHtml(type.anchor)}">${escapeHtml(heading)}</h2>`,
    prose(type.description, context),
    key,
    note(type.comment, context, 'Authoring note'),
    renderConditions(type, context),
    type.fields.map((field) => renderField(field, context)).join('\n'),
  ]
    .filter((part) => part !== '')
    .join('\n')
}

/** The whole field reference for one family at one version. */
export function renderReference(model: ReferenceModel, context: PageContext): string {
  const actions = [
    link(context.schemaPath, 'JSON Schema'),
    context.prosePath === null ? '' : link(context.prosePath, 'Specification'),
    context.examplesPath === null ? '' : link(context.examplesPath, 'Examples'),
    link(context.sourceUrl, 'Source'),
  ]
    .filter((a) => a !== '')
    .join(' · ')

  const toc = [model.root, ...model.types]
    .map((type) => `<a href="#${escapeHtml(type.anchor)}">${escapeHtml(type.name)}</a>`)
    .join('')

  return [
    `<p class="muted">${link('/reference/', 'Reference')} / ${escapeHtml(model.family)}</p>`,
    `<h1>${escapeHtml(model.title)}</h1>`,
    model.description === undefined ? '' : `<p class="lead">${escapeHtml(model.description)}</p>`,
    `<p>${actions}</p>`,
    // The status note every page carries. The rendering is a view of the
    // normative artifacts, never a fourth one; see ADR 0017.
    '<p class="muted">This reference is generated from the schema bundle and is informative. ' +
      'Where it differs from the specification, the specification governs. ' +
      'A documented default is an annotation: no validator inserts it.</p>',
    model.comment === undefined ? '' : `<p class="muted">${escapeHtml(model.comment)}</p>`,
    `<h2>Contents</h2><nav class="toc">${toc}</nav>`,
    renderType(model.root, context, `${model.family} document`),
    ...model.types.map((type) => renderType(type, context, type.name)),
  ]
    .filter((part) => part !== '')
    .join('\n')
}
