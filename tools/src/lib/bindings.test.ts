/**
 * The §2 bindings tables, read exactly as the family template in
 * docs/adr/0022 writes them.
 */
import { describe, expect, test } from 'bun:test'
import { BindingsError, parseBindings } from './bindings.ts'

/** The design's §2 template, filled in for one family. */
function template(options: {
  kind: string
  title: string
  metadata: string
  nullFields: string
  itemDocument: string
  extraDependencies?: string[]
}): string {
  return [
    '# Musher Example Specification',
    '',
    '## <a id="scope"></a>1. Scope',
    '',
    'Scope prose, with an unrelated table.',
    '',
    '| Core parameter | This family |',
    '|---|---|',
    '| `kind` | `DECOY` |',
    '',
    '## <a id="envelope"></a>2. Document envelope',
    '',
    '```yaml',
    'specVersion: v1',
    `kind: ${options.kind}`,
    'metadata: { … }',
    'spec: { … }',
    '```',
    '',
    `A ${options.title} Document is a Musher document as the`,
    '[Musher Document Core Specification](../../core/v1/spec.md) defines one, and',
    'every rule of core v1 applies to it. This family binds the parameters',
    '[core v1 §1.1](../../core/v1/spec.md#bindings) leaves to a family:',
    '',
    '| Core parameter | This family |',
    '|---|---|',
    `| \`kind\` ([\`CORE-ENV-002\`](../../core/v1/spec.md#CORE-ENV-002)) | \`${options.kind}\` |`,
    `| \`metadata\` ([\`CORE-ENV-003\`](../../core/v1/spec.md#CORE-ENV-003)) | ${options.metadata} |`,
    `| Fields accepting \`null\` ([\`CORE-ENV-007\`](../../core/v1/spec.md#CORE-ENV-007)) | ${options.nullFields} |`,
    `| Item document ([core v1 §4.1](../../core/v1/spec.md#item-directory)) | ${options.itemDocument} |`,
    '',
    'This specification narrows core v1 where it says so and relaxes it nowhere. It',
    'cites core by its line — "core v1 §N" — and the core edition a release was',
    'built and tested against is recorded with that release',
    '([core v1 §9](../../core/v1/spec.md#editions)).',
    '',
    '**Normative dependencies**',
    '',
    '| Specification | Line |',
    '|---|---|',
    '| [core](../../core/v1/spec.md) | v1 |',
    ...(options.extraDependencies ?? []),
    '',
    '## <a id="metadata"></a>3. Metadata',
    '',
    '| Specification | Line |',
    '|---|---|',
    '| [decoy](../../decoy/v9/spec.md) | v9 |',
    '',
  ].join('\n')
}

const COMPONENT = template({
  kind: 'COMPONENT',
  title: 'Component',
  metadata: '[§4](#metadata)',
  nullFields: '`schedule` — [§5](#workload)',
  itemDocument: 'No — it sits inside an item',
})

const BLUEPRINT = template({
  kind: 'BLUEPRINT',
  title: 'Blueprint',
  metadata: '[§3](#metadata)',
  nullFields: '`size` — [§4.3](#compute-profile)',
  itemDocument: '`blueprint.yaml`',
  extraDependencies: ['| [component](../../component/v1/spec.md) | v1 |'],
})

const LISTING = template({
  kind: 'LISTING',
  title: 'Listing',
  metadata: '[§3](#metadata)',
  nullFields: 'none',
  itemDocument: '`listing.yaml`',
})

function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe('parseBindings', () => {
  test('reads a component §2 that sits inside an item and names one null field', () => {
    expect(parseBindings(COMPONENT)).toEqual({
      kind: 'COMPONENT',
      metadataSection: { number: '4', anchor: 'metadata' },
      nullFields: ['schedule'],
      itemDocument: null,
      dependencies: [{ family: 'core', line: 'v1' }],
    })
  })

  test("reads blueprint's extra component dependency, in table order", () => {
    expect(parseBindings(BLUEPRINT)).toEqual({
      kind: 'BLUEPRINT',
      metadataSection: { number: '3', anchor: 'metadata' },
      nullFields: ['size'],
      itemDocument: 'blueprint.yaml',
      dependencies: [
        { family: 'core', line: 'v1' },
        { family: 'component', line: 'v1' },
      ],
    })
  })

  test('reads "none" as no null fields', () => {
    const bindings = parseBindings(LISTING)
    expect(bindings?.nullFields).toEqual([])
    expect(bindings?.itemDocument).toBe('listing.yaml')
  })

  test('reads only §2: a same-shaped table in another section is ignored', () => {
    // The decoys in §1 and §3 would add a DECOY kind and a decoy dependency.
    const bindings = parseBindings(LISTING)
    expect(bindings?.kind).toBe('LISTING')
    expect(bindings?.dependencies).toEqual([{ family: 'core', line: 'v1' }])
  })

  test("is null for today's §2, which carries neither table", () => {
    const today = [
      '## <a id="envelope"></a>2. Document envelope',
      '',
      '`kind` MUST be `LISTING`. All envelope rules in',
      '[component §2](../../component/v1/spec.md#envelope) apply identically.',
      '',
      '| ID | Field | Requirement |',
      '|---|---|---|',
      '| x | y | z |',
      '',
    ].join('\n')
    expect(parseBindings(today)).toBeNull()
  })

  test('is null for a document with no envelope section at all', () => {
    expect(parseBindings('## <a id="scope"></a>1. Scope\n')).toBeNull()
  })

  test('throws when only one of the two tables is present', () => {
    const noDependencies = LISTING.replace('| Specification | Line |', '| Something | Else |')
    expect(thrown(() => parseBindings(noDependencies))).toBeInstanceOf(BindingsError)

    const noParameters = LISTING.replace(/\| Core parameter \| This family \|/g, '| A | B |')
    expect(thrown(() => parseBindings(noParameters))).toBeInstanceOf(BindingsError)
  })

  test('throws on a row the template does not describe, rather than skipping it', () => {
    const cases = [
      LISTING.replace('| `LISTING` |', '| LISTING |'),
      LISTING.replace('| [§3](#metadata) |', '| §3 |'),
      LISTING.replace('| `listing.yaml` |', '| listing.yml |'),
      LISTING.replace('| none |', '| schedule |'),
      LISTING.replace(
        '| [core](../../core/v1/spec.md) | v1 |',
        '| [core](../../core/v2/spec.md) | v1 |',
      ),
      LISTING.replace('| Item document (', '| Item file ('),
    ]
    for (const markdown of cases) {
      expect(thrown(() => parseBindings(markdown))).toBeInstanceOf(BindingsError)
    }
  })

  test('throws when a parameter row is missing', () => {
    const missing = LISTING.split('\n')
      .filter((line) => !line.startsWith('| Item document'))
      .join('\n')
    expect((thrown(() => parseBindings(missing)) as Error).message).toContain('itemDocument')
  })
})
