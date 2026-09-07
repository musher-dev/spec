/**
 * The prose renderer loses nothing: anchors, tables and citations all survive,
 * and anything it cannot render faithfully fails the build instead.
 *
 * The last three tests run against the real `spec.md` files rather than
 * fixtures. That is deliberate — they are the drift guard. A new construct in
 * the normative prose that this renderer mangles should fail here, in a test
 * naming the family, rather than on the published page.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { type ProseContext, readOutline, renderInline, renderProse } from './prose.ts'
import { discoverFamilies } from './spec.ts'

const SPEC = '<test>'

function context(markdown: string, resolve = (t: string) => `/resolved/${t}`): ProseContext {
  return {
    base: '/reference/component/v1/spec/',
    outline: readOutline(markdown),
    resolveLink: resolve,
  }
}

describe('readOutline', () => {
  const source = [
    '## <a id="scope"></a>1. Scope',
    '',
    'Text.',
    '',
    '## <a id="envelope"></a>2. Document envelope',
    '',
    '| <a id="COMP-ENV-001"></a>`COMP-ENV-001` | `specVersion` |',
    '|---|---|',
    '| a | b |',
    '',
    '### <a id="yaml-profile"></a>7.1 The Musher YAML profile',
  ].join('\n')

  test('strips the anchor and the number, keeping both', () => {
    const { sections } = readOutline(source)
    expect(sections).toHaveLength(3)
    expect(sections[0]).toEqual({ id: 'scope', number: '1', title: 'Scope', level: 2 })
    expect(sections[2]).toEqual({
      id: 'yaml-profile',
      number: '7.1',
      title: 'The Musher YAML profile',
      level: 3,
    })
  })

  test('indexes a section by its authored number', () => {
    expect(readOutline(source).byNumber.get('7.1')).toBe('yaml-profile')
    expect(readOutline(source).byNumber.get('2')).toBe('envelope')
  })

  test('binds a requirement id to the section stating it', () => {
    expect(readOutline(source).requirements.get('COMP-ENV-001')).toBe('envelope')
  })

  test('a section anchor is not mistaken for a requirement', () => {
    expect(readOutline(source).requirements.has('scope')).toBe(false)
  })
})

describe('renderProse', () => {
  test('renders a pipe table as a table', () => {
    const html = renderProse('| a | b |\n|---|---|\n| 1 | 2 |\n', null, SPEC)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<td>2</td>')
  })

  test('keeps an explicit anchor, in a heading and inside a table cell', () => {
    const html = renderProse(
      '## <a id="envelope"></a>2. Envelope\n\n| <a id="COMP-ENV-001"></a>`X` |\n|---|\n| y |\n',
      null,
      SPEC,
    )
    expect(html).toContain('<a id="envelope"></a>')
    expect(html).toContain('<a id="COMP-ENV-001"></a>')
  })

  test('refuses a table row it cannot split faithfully', () => {
    expect(() => renderProse('| `a|b` | c |\n|---|---|\n| 1 | 2 |\n', null, SPEC)).toThrow(
      /code span containing a pipe/,
    )
  })

  test('rewrites a relative link through the injected resolver', () => {
    const html = renderProse('[x](../../blueprint/v1/spec.md#y)\n', context(''), SPEC)
    expect(html).toContain('href="/resolved/../../blueprint/v1/spec.md#y"')
  })

  test('links a citation whose clause the outline knows', () => {
    const outline = '## <a id="endpoints"></a>5.2 Endpoints\n'
    const html = renderProse(`${outline}\nSee §5.2 for the rule.\n`, context(outline), SPEC)
    expect(html).toContain('href="/reference/component/v1/spec/#endpoints"')
    expect(html).toContain('>§5.2</a>')
  })

  test('leaves a citation the outline does not know as plain text', () => {
    const html = renderProse('See §9.9 for the rule.\n', context(''), SPEC)
    expect(html).not.toContain('<a href')
    expect(html).toContain('§9.9')
  })

  test('does not rewrite a link inside a code span', () => {
    const html = renderProse('`../../x/spec.md` and §9.9\n', context(''), SPEC)
    expect(html).toContain('<code>../../x/spec.md</code>')
    expect(html).not.toContain('href="/resolved/')
  })
})

describe('what the renderer refuses or leaves alone', () => {
  test('a citation inside a link label is left alone', () => {
    // `[component §3](../../component/v1/spec.md#compatibility)` must not gain
    // an inner <a>: HTML forbids nesting, and the inner href would resolve
    // against THIS document, sending "§3" to this family's §3 instead.
    const outline = '## <a id="identity"></a>3. Identity\n'
    const html = renderProse(
      `${outline}\n[component §3](../../component/v1/spec.md#compatibility)\n`,
      context(outline, () => '/reference/component/v1/spec/#compatibility'),
      SPEC,
    )
    expect(html).toContain('>component §3</a>')
    expect(html).not.toMatch(/<a [^>]*>[^<]*<a /)
  })

  test('a citation outside a link is still linked', () => {
    const outline = '## <a id="identity"></a>3. Identity\n'
    const html = renderProse(`${outline}\nSee §3.\n`, context(outline), SPEC)
    expect(html).toContain('#identity"')
  })

  test('a pipe table inside a fenced block stays inside the fence', () => {
    const html = renderProse(
      'Before\n\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n```\n\nAfter\n',
      null,
      SPEC,
    )
    // Lifting it out would leave the closing fence re-opening a code block and
    // swallowing everything after it.
    expect(html).not.toContain('<table>')
    expect(html).toContain('<p>After</p>')
  })

  test('a real table after a fenced block is still rendered', () => {
    const html = renderProse('```\ncode\n```\n\n| a |\n|---|\n| 1 |\n', null, SPEC)
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  test('a row escaping a pipe is refused rather than mis-split', () => {
    expect(() => renderProse('| x \\| y | z |\n|---|---|\n| 1 | 2 |\n', null, SPEC)).toThrow(
      /escapes a pipe/,
    )
  })
})

describe('renderInline', () => {
  test('renders a reStructuredText double-backtick span as code', () => {
    expect(renderInline('A node names ``component``.', null)).toContain('<code>component</code>')
  })

  test('renders an embedded blank line as two paragraphs', () => {
    const html = renderInline('One.\n\nTwo.', null)
    expect(html.match(/<p>/g)).toHaveLength(2)
  })
})

describe('the real specifications', () => {
  const families = discoverFamilies()

  test('every family has prose', () => {
    expect(families.length).toBeGreaterThan(0)
  })

  for (const family of families) {
    const markdown = readFileSync(family.specPath, 'utf8')
    const where = `${family.name}/${family.major}/spec.md`

    test(`${family.name}: every source table becomes a rendered table`, () => {
      const expected = markdown.split('\n').filter((l) => /^\|[\s:|-]+\|$/.test(l)).length
      const html = renderProse(markdown, null, where)
      expect(expected).toBeGreaterThan(0)
      expect(html.match(/<table>/g) ?? []).toHaveLength(expected)
    })

    test(`${family.name}: every explicit anchor survives`, () => {
      const anchors = [...markdown.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1])
      const html = renderProse(markdown, null, where)
      expect(anchors.length).toBeGreaterThan(0)
      for (const id of anchors) expect(html).toContain(`<a id="${id}"></a>`)
    })

    test(`${family.name}: a documented tag stays escaped`, () => {
      const html = renderProse(markdown, null, where)
      // listing §4.1 documents `<script>` in a code span. It must never become
      // a tag, and no other raw tag may appear that the prose did not author.
      for (const tag of ['<script', '<iframe', '<object']) {
        expect(html).not.toContain(tag)
      }
    })
  }
})
