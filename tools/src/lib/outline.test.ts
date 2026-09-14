/**
 * The section a requirement is declared under, and the sections enclosing it.
 */
import { describe, expect, test } from 'bun:test'
import { enclosingSections, readOutline } from './outline.ts'

const SOURCE = [
  '<a id="CORE-TOP-001"></a>before any heading',
  '## <a id="scope"></a>1. Scope',
  '### <a id="bindings"></a>1.1 Bindings',
  '## <a id="validation-layers"></a>6. Validation layers',
  '<a id="CORE-VAL-001"></a>under the top-level section',
  '### <a id="yaml-profile"></a>6.1 The Musher YAML profile',
  '| <a id="CORE-YAML-001"></a>`CORE-YAML-001` | rule |',
  '### <a id="format-policy"></a>6.2 The `format` keyword',
  '<a id="CORE-FMT-001"></a>rule',
].join('\n')

describe('enclosingSections', () => {
  const outline = readOutline(SOURCE)

  test('lists the declaring section, then each parent', () => {
    expect(enclosingSections(outline, 'CORE-YAML-001')).toEqual([
      'yaml-profile',
      'validation-layers',
    ])
  })

  test('does not treat a preceding sibling as a parent', () => {
    expect(enclosingSections(outline, 'CORE-FMT-001')).toEqual([
      'format-policy',
      'validation-layers',
    ])
  })

  test('a requirement under a top-level section has only that section', () => {
    expect(enclosingSections(outline, 'CORE-VAL-001')).toEqual(['validation-layers'])
  })

  test('is empty for an undeclared ID or one before the first heading', () => {
    expect(enclosingSections(outline, 'CORE-NONE-001')).toEqual([])
    expect(enclosingSections(outline, 'CORE-TOP-001')).toEqual([])
  })
})
