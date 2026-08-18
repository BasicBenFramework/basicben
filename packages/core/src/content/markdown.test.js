/**
 * Markdown parser tests.
 *
 * The CommonMark spec suite is vendored beside this file and run in full. It is
 * the only honest way to answer "is this parser correct" — a hand-picked set of
 * examples measures the author's imagination, not the implementation.
 *
 * Two numbers come out of it, and they mean different things:
 *
 *   - the raw pass rate, which includes 64 cases that exist solely to require
 *     raw HTML passthrough. This parser refuses those by design, so the raw
 *     number can never reach 100% and is not the number to judge it by;
 *   - the pass rate excluding those two sections, which is the real measure.
 *
 * Both are asserted against a floor rather than an exact value, so a regression
 * fails the build while an improvement does not.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderMarkdown } from './markdown.js'
import { renderContent, renderContentSync, excerpt, slugify, headings } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(here, 'commonmark-spec.json'), 'utf8'))

/** Sections that exist to mandate raw HTML passthrough, which we refuse. */
const HTML_SECTIONS = new Set(['HTML blocks', 'Raw HTML'])

/**
 * Compare ignoring insignificant whitespace.
 *
 * The spec pins exact line endings between block elements. Those differences
 * are invisible in a browser, and holding the parser to them would bury the
 * structural failures that actually matter under formatting noise.
 */
const normalize = (html) => html
  .replace(/\n+/g, '\n')
  .replace(/>\s+</g, '><')
  .replace(/\s+/g, ' ')
  .trim()

describe('CommonMark specification suite', () => {
  const results = { total: 0, passed: 0, prose: { total: 0, passed: 0 } }

  for (const example of spec) {
    let got
    try {
      got = renderMarkdown(example.markdown, { headingIds: false })
    } catch (error) {
      got = `THREW: ${error.message}`
    }

    const ok = normalize(got) === normalize(example.html)

    results.total++
    if (ok) results.passed++

    if (!HTML_SECTIONS.has(example.section)) {
      results.prose.total++
      if (ok) results.prose.passed++
    }
  }

  test('never throws on any of the 652 examples', () => {
    for (const example of spec) {
      assert.doesNotThrow(
        () => renderMarkdown(example.markdown),
        `threw on example ${example.example}`
      )
    }
  })

  test('passes at least 93% of everything but the raw-HTML sections', () => {
    const rate = results.prose.passed / results.prose.total

    console.log(
      `      CommonMark: ${results.prose.passed}/${results.prose.total} ` +
      `(${(rate * 100).toFixed(1)}%) excluding raw HTML; ` +
      `${results.passed}/${results.total} (${(results.passed / results.total * 100).toFixed(1)}%) overall`
    )

    assert.ok(rate >= 0.93, `dropped to ${(rate * 100).toFixed(1)}%`)
  })

  test('the raw-HTML sections fail, which is the design', () => {
    // If these ever start passing, someone has added HTML passthrough and the
    // safe-by-construction property is gone.
    const passthrough = spec.filter((e) => e.section === 'HTML blocks')
    const passing = passthrough.filter(
      (e) => normalize(renderMarkdown(e.markdown, { headingIds: false })) === normalize(e.html)
    )

    assert.equal(passing.length, 0, 'raw HTML is being passed through')
  })
})

describe('safety', () => {
  test('HTML in the source is shown, never executed', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    assert.ok(!out.includes('<script'))
    assert.ok(out.includes('&lt;script&gt;'))
  })

  test('inline HTML is escaped too', () => {
    const out = renderMarkdown('Hello <img src=x onerror=alert(1)> there')
    assert.ok(!/<img/i.test(out))
    assert.ok(!/onerror/i.test(out) || out.includes('&lt;img'))
  })

  test('a javascript: link does not become an anchor', () => {
    const out = renderMarkdown('[click](javascript:alert(1))')
    assert.ok(!out.includes('<a '), out)
    assert.ok(!/href/i.test(out))
  })

  test('a javascript: image does not become an img', () => {
    const out = renderMarkdown('![x](javascript:alert(1))')
    assert.ok(!out.includes('<img'), out)
  })

  test('an entity-obfuscated scheme is caught', () => {
    const out = renderMarkdown('[x](&#x6A;avascript:alert&#40;1&#41;)')
    assert.ok(!out.includes('<a '), out)
  })

  test('a javascript: autolink stays text', () => {
    const out = renderMarkdown('<javascript:alert(1)>')
    assert.ok(!out.includes('<a '), out)
  })

  test('a javascript: reference link is refused', () => {
    const out = renderMarkdown('[x]\n\n[x]: javascript:alert(1)')
    assert.ok(!out.includes('<a '), out)
  })

  test('quotes in a title cannot break out of the attribute', () => {
    const out = renderMarkdown('[x](/a "b\\" onmouseover=\\"alert(1)")')

    // The escaped form is the correct outcome: the browser reads &quot; as a
    // literal quote in the tooltip, not as the end of the attribute. What must
    // not appear is a *raw* quote, which would close `title` and start a real
    // handler attribute.
    assert.ok(out.includes('&quot;'), out)
    assert.ok(!/"\s+on[a-z]+\s*=/i.test(out), out)
  })

  test('a code fence info string cannot inject an attribute', () => {
    const out = renderMarkdown('```js" onload="alert(1)\nx\n```')
    assert.ok(!/\sonload=/i.test(out), out)
  })

  test('every tag in the output is one the renderer emits', () => {
    // The safety claim in one assertion: run the entire spec corpus through and
    // check that nothing outside the known vocabulary ever appears.
    const emitted = new Set([
      'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'del',
      'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ])

    for (const example of spec) {
      const out = renderMarkdown(example.markdown)
      for (const [, name] of out.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) {
        assert.ok(
          emitted.has(name.toLowerCase()),
          `example ${example.example} produced <${name}>`
        )
      }
    }
  })
})

describe('block structure', () => {
  test('ATX headings', () => {
    assert.ok(renderMarkdown('# One').includes('<h1'))
    assert.ok(renderMarkdown('###### Six').includes('<h6'))
  })

  test('setext headings win over thematic breaks under a paragraph', () => {
    // Read the other way round, every `Title\n-----` becomes a paragraph and a
    // horizontal rule.
    const out = renderMarkdown('Title\n-----')
    assert.ok(out.includes('<h2'), out)
    assert.ok(!out.includes('<hr'), out)
  })

  test('a thematic break with no paragraph above it is still a break', () => {
    assert.ok(renderMarkdown('a\n\n---\n\nb').includes('<hr'))
  })

  test('fenced code keeps its language', () => {
    const out = renderMarkdown('```python\nx = 1\n```')
    assert.ok(out.includes('class="language-python"'))
    assert.ok(out.includes('x = 1'))
  })

  test('code content is escaped', () => {
    const out = renderMarkdown('```\n<script>alert(1)</script>\n```')
    assert.ok(out.includes('&lt;script&gt;'))
    assert.ok(!out.includes('<script>'))
  })

  test('indented code', () => {
    assert.ok(renderMarkdown('    indented').includes('<pre><code>indented'))
  })

  test('blockquotes nest', () => {
    const out = renderMarkdown('> a\n>\n> > b')
    assert.equal((out.match(/<blockquote>/g) || []).length, 2)
  })

  test('a tight list has no paragraphs', () => {
    const out = renderMarkdown('- a\n- b')
    assert.ok(!out.includes('<p>'), out)
  })

  test('a loose list has them', () => {
    const out = renderMarkdown('- a\n\n- b')
    assert.ok(out.includes('<p>'), out)
  })

  test('a blank line in a nested list does not loosen its ancestors', () => {
    // The failure this guards against is a paragraph's margin appearing around
    // every bullet at every level above the one that actually had the blank.
    const out = renderMarkdown('- a\n  - b\n\n    c\n- d')
    assert.ok(out.startsWith('<ul>\n<li>a'), out)
    assert.ok(out.includes('<li>d</li>'), out)
  })

  test('ordered lists keep their starting number', () => {
    assert.ok(renderMarkdown('5. five\n6. six').includes('start="5"'))
  })

  test('an ordered marker mid-paragraph does not start a list', () => {
    const out = renderMarkdown('The number of windows is\n14. The number of doors is 6.')
    assert.ok(!out.includes('<ol'), out)
  })

  test('nested lists', () => {
    const out = renderMarkdown('- a\n  - b\n    - c')
    assert.equal((out.match(/<ul>/g) || []).length, 3)
  })

  test('tables with alignment', () => {
    const out = renderMarkdown('| a | b |\n|:--|--:|\n| 1 | 2 |')
    assert.ok(out.includes('<table>'))
    assert.ok(out.includes('align="left"'))
    assert.ok(out.includes('align="right"'))
    assert.ok(out.includes('<td'))
  })

  test('a ragged table row is padded rather than left ragged', () => {
    const out = renderMarkdown('| a | b |\n|---|---|\n| 1 |')
    assert.equal((out.match(/<td/g) || []).length, 2)
  })

  test('an escaped pipe stays inside its cell', () => {
    const out = renderMarkdown('| a | b |\n|---|---|\n| x \\| y | z |')
    assert.equal((out.match(/<td/g) || []).length, 2)
    assert.ok(out.includes('x | y'))
  })
})

describe('inline structure', () => {
  test('emphasis and strong', () => {
    assert.ok(renderMarkdown('*a*').includes('<em>a</em>'))
    assert.ok(renderMarkdown('**a**').includes('<strong>a</strong>'))
    assert.ok(renderMarkdown('***a***').includes('<em>'))
  })

  test('underscores inside a word are left alone', () => {
    // Without the stricter flanking rule for `_`, snake_case turns into italics.
    const out = renderMarkdown('snake_case_words')
    assert.ok(!out.includes('<em>'), out)
  })

  test('strikethrough', () => {
    assert.ok(renderMarkdown('~~gone~~').includes('<del>gone</del>'))
  })

  test('a single tilde is literal', () => {
    assert.ok(!renderMarkdown('a ~ b').includes('<del>'))
  })

  test('code spans', () => {
    assert.ok(renderMarkdown('`x`').includes('<code>x</code>'))
    assert.ok(renderMarkdown('`` a ` b ``').includes('a ` b'))
  })

  test('links and titles', () => {
    const out = renderMarkdown('[a](https://x.com "T")')
    assert.ok(out.includes('href="https://x.com"'))
    assert.ok(out.includes('title="T"'))
  })

  test('reference links', () => {
    const out = renderMarkdown('[a][ref]\n\n[ref]: https://x.com')
    assert.ok(out.includes('href="https://x.com"'))
  })

  test('shortcut reference links', () => {
    const out = renderMarkdown('[ref]\n\n[ref]: https://x.com')
    assert.ok(out.includes('href="https://x.com"'))
  })

  test('a reference definition spanning lines', () => {
    const out = renderMarkdown('[a]\n\n[a]:\n  https://x.com\n  "T"')
    assert.ok(out.includes('href="https://x.com"'), out)
    assert.ok(out.includes('title="T"'), out)
  })

  test('images', () => {
    const out = renderMarkdown('![alt](/a.png)')
    assert.ok(out.includes('<img src="/a.png"'))
    assert.ok(out.includes('alt="alt"'))
  })

  test('autolinks', () => {
    assert.ok(renderMarkdown('<https://x.com>').includes('href="https://x.com"'))
    assert.ok(renderMarkdown('<a@b.co>').includes('href="mailto:a@b.co"'))
  })

  test('hard line breaks', () => {
    // Two trailing spaces are the syntax, and trimming lines destroys it.
    assert.ok(renderMarkdown('a  \nb').includes('<br />'))
    assert.ok(renderMarkdown('a\\\nb').includes('<br />'))
  })

  test('a soft break stays a newline', () => {
    const out = renderMarkdown('a\nb')
    assert.ok(!out.includes('<br'))
    assert.ok(out.includes('a\nb'))
  })

  test('backslash escapes suppress markup', () => {
    assert.ok(!renderMarkdown('\\*not em\\*').includes('<em>'))
    assert.ok(!renderMarkdown('\\`not code\\`').includes('<code>'))
  })

  test('a backslash before a non-punctuation character is literal', () => {
    assert.ok(renderMarkdown('\\q').includes('\\q'))
  })

  test('non-ASCII URLs are percent-encoded', () => {
    assert.ok(renderMarkdown('[a](/föö)').includes('/f%C3%B6%C3%B6'))
  })

  test('an already-encoded URL is not encoded twice', () => {
    assert.ok(renderMarkdown('[a](/a%20b)').includes('/a%20b'))
  })
})

describe('heading anchors', () => {
  test('headings get ids by default', () => {
    assert.ok(renderMarkdown('# Hello World').includes('id="hello-world"'))
  })

  test('ids can be turned off', () => {
    assert.ok(!renderMarkdown('# Hello', { headingIds: false }).includes('id='))
  })

  test('duplicate headings get distinct ids', () => {
    const out = renderMarkdown('# Same\n\n# Same')
    assert.ok(out.includes('id="same"'))
    assert.ok(out.includes('id="same-2"'))
  })

  test('inline markup is stripped from the slug', () => {
    assert.ok(renderMarkdown('# A `code` heading').includes('id="a-code-heading"'))
  })
})

describe('content pipeline', () => {
  test('renderContent sanitizes as well as renders', async () => {
    const out = await renderContent('# Title\n\nSome *text*.')
    assert.ok(out.includes('<h1'))
    assert.ok(out.includes('<em>text</em>'))
  })

  test('renderContent survives HTML in the source', async () => {
    const out = await renderContent('<script>alert(1)</script>\n\nAfter')
    assert.ok(!out.includes('<script'))
    assert.ok(out.includes('After'))
  })

  test('the sync renderer matches the async one when no plugin is loaded', async () => {
    const source = '# H\n\n- a\n- b\n\n[x](https://y.co)\n\n```js\nvar a = 1\n```'
    assert.equal(renderContentSync(source), await renderContent(source))
  })

  test('excerpt returns plain text, never markup', () => {
    const out = excerpt('# Title\n\nSome **bold** text and [a link](https://x.com).')
    assert.ok(!out.includes('<'))
    assert.ok(out.includes('bold'))
  })

  test('excerpt cuts at a word boundary', () => {
    const out = excerpt('word '.repeat(100), 50)
    assert.ok(out.length <= 51, `got ${out.length}`)
    assert.ok(out.endsWith('…'))
    assert.ok(!/\bwor…$/.test(out), 'cut mid-word')
  })

  test('excerpt leaves short text alone', () => {
    assert.equal(excerpt('Short.'), 'Short.')
  })

  test('excerpt handles empty input', () => {
    assert.equal(excerpt(''), '')
    assert.equal(excerpt(null), '')
  })

  test('slugify', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world')
    assert.equal(slugify('  Spaces  Everywhere  '), 'spaces-everywhere')
    assert.equal(slugify('Café Résumé'), 'cafe-resume')
    assert.equal(slugify('a--b'), 'a-b')
  })

  test('headings extracts a table of contents', () => {
    const toc = headings('# One\n\n## Two\n\n### Three')
    assert.deepEqual(toc.map((h) => h.level), [1, 2, 3])
    assert.deepEqual(toc.map((h) => h.id), ['one', 'two', 'three'])
  })

  test('headings ignores hashes inside code fences', () => {
    const toc = headings('# Real\n\n```sh\n# not a heading\n```')
    assert.equal(toc.length, 1)
  })

  test('heading ids match the anchors the renderer produced', () => {
    const source = '# Same\n\n## Same'
    const ids = headings(source).map((h) => h.id)
    const html = renderMarkdown(source)

    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), `${id} is not in the rendered output`)
    }
  })
})

describe('robustness', () => {
  test('empty and null input', () => {
    assert.equal(renderMarkdown(''), '')
    assert.equal(renderMarkdown(null), '')
    assert.equal(renderMarkdown(undefined), '')
  })

  test('CRLF line endings', () => {
    assert.equal(renderMarkdown('a\r\n\r\nb'), renderMarkdown('a\n\nb'))
  })

  test('a lone CR is a line ending too', () => {
    assert.equal(renderMarkdown('a\r\rb'), renderMarkdown('a\n\nb'))
  })

  test('unterminated constructs do not hang or throw', () => {
    for (const source of [
      '```\nunclosed fence',
      '> quote with no end',
      '[unclosed link](',
      '*unclosed emphasis',
      '`unclosed code',
      '| a | b\n|---',
      '- item\n  - nested with no end',
      '<https://unclosed'
    ]) {
      assert.doesNotThrow(() => renderMarkdown(source), source)
    }
  })

  test('deeply nested input completes', () => {
    const deep = '> '.repeat(80) + 'bottom'
    assert.doesNotThrow(() => renderMarkdown(deep))
  })

  test('a long document completes in reasonable time', () => {
    const document = '# Heading\n\nSome *text* with a [link](https://x.com).\n\n- a\n- b\n\n'.repeat(500)
    const started = process.hrtime.bigint()
    renderMarkdown(document)
    const ms = Number(process.hrtime.bigint() - started) / 1e6

    assert.ok(ms < 4000, `took ${ms.toFixed(0)}ms`)
  })
})
