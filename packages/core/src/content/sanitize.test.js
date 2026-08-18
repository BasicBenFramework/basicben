/**
 * Sanitizer tests.
 *
 * The corpus below is the point of this file. A sanitizer that passes a handful
 * of tidy cases proves nothing — what matters is the payloads written
 * specifically to slip past one, and those are almost all built on a mismatch
 * between what a naive parser reads and what a browser executes: a NUL in a tag
 * name, an entity that only becomes a scheme after decoding, a `>` inside a
 * quoted attribute, a namespace prefix, a tag that never closes.
 *
 * Each case here asserts the absence of the two things that actually cause
 * harm — an executable tag, and an event-handler attribute — rather than an
 * exact output string, so the tests keep their meaning if the escaping details
 * change.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  sanitizeHtml,
  isSafeUrl,
  escapeHtml,
  decodeEntities,
  stripTags,
  DEFAULT_ALLOWED
} from './sanitize.js'

/** Payloads that must never produce script-capable output. */
const XSS_CORPUS = [
  // The obvious ones
  '<script>alert(1)</script>',
  '<SCRIPT>alert(1)</SCRIPT>',
  '<script src="https://evil.example/x.js"></script>',
  '<script\n>alert(1)</script>',
  '<script/xss>alert(1)</script>',

  // Event handlers on tags that are otherwise allowed
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)">',
  '<img src=x onerror=alert(1)//>',
  '<a href="#" onclick="alert(1)">click</a>',
  '<a href="#" ONCLICK="alert(1)">click</a>',
  '<p onmouseover="alert(1)">hover</p>',
  '<body onload=alert(1)>',
  '<svg onload=alert(1)>',
  '<div onfocus="alert(1)" autofocus>',

  // Script-bearing URLs
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href="java\nscript:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#x6A;avascript:alert(1)">x</a>',
  '<a href="&#0000106;avascript:alert(1)">x</a>',
  '<a href="  javascript:alert(1)">x</a>',
  '<img src="javascript:alert(1)">',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',

  // Parser-confusion tricks
  '<scr<script>ipt>alert(1)</script>',
  '<<script>alert(1);//<</script>',
  '<img """><script>alert(1)</script>">',
  '<img src="x" title="a > b" onerror="alert(1)">',
  '<a title="](javascript:alert(1))">x</a>',
  '<svg><script>alert(1)</script></svg>',
  '<math><script>alert(1)</script></math>',
  '<svg:script>alert(1)</svg:script>',
  '<xml:script>alert(1)</xml:script>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><input type=submit></form>',
  '<isindex action="javascript:alert(1)" type=submit>',
  '<template><script>alert(1)</script></template>',
  '<noscript><p title="</noscript><script>alert(1)</script>">',
  '<style>@import "javascript:alert(1)";</style>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<p style="position:fixed;top:0;left:0;width:100vw;height:100vh">overlay</p>',

  // Unclosed and malformed
  '<script>alert(1)',
  '<a href="javascript:alert(1)"',
  '<div><span><script>alert(1)</script>',
  '</p><script>alert(1)</script>',

  // Comments and doctype
  '<!--<script>alert(1)</script>-->',
  '<!--[if IE]><script>alert(1)</script><![endif]-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<!DOCTYPE html><script>alert(1)</script>'
]

describe('sanitizeHtml against an XSS corpus', () => {
  for (const payload of XSS_CORPUS) {
    test(JSON.stringify(payload).slice(0, 72), () => {
      const out = sanitizeHtml(payload)

      assert.ok(!/<script/i.test(out), `script tag survived: ${out}`)
      assert.ok(!/<iframe/i.test(out), `iframe survived: ${out}`)
      assert.ok(!/<object|<embed|<applet/i.test(out), `plugin element survived: ${out}`)
      assert.ok(!/<svg|<math/i.test(out), `foreign content survived: ${out}`)
      assert.ok(!/<style/i.test(out), `style element survived: ${out}`)
      assert.ok(!/\son[a-z]+\s*=/i.test(out), `event handler survived: ${out}`)
      assert.ok(!/\sstyle\s*=/i.test(out), `style attribute survived: ${out}`)

      // Only in an attribute the browser resolves. The same characters sitting
      // in a `title` are a tooltip, and asserting on their absence anywhere
      // would be testing for something that cannot hurt anyone.
      const urlAttributes = out.match(/\s(?:href|src|srcset|action|poster|cite)\s*=\s*"([^"]*)"/gi) || []
      for (const attribute of urlAttributes) {
        assert.ok(!/javascript:/i.test(attribute), `javascript: URL survived: ${out}`)
        assert.ok(!/vbscript:/i.test(attribute), `vbscript: URL survived: ${out}`)
        assert.ok(!/data:text\/html/i.test(attribute), `data:text/html survived: ${out}`)
      }
    })
  }
})

describe('sanitizeHtml keeps legitimate markup', () => {
  test('allowed tags survive', () => {
    const html = '<p>Hello <strong>world</strong> and <em>others</em>.</p>'
    assert.equal(sanitizeHtml(html), html)
  })

  test('links keep href and title', () => {
    const out = sanitizeHtml('<a href="https://example.com" title="Example">x</a>')
    assert.ok(out.includes('href="https://example.com"'))
    assert.ok(out.includes('title="Example"'))
  })

  test('relative links survive', () => {
    assert.ok(sanitizeHtml('<a href="/about">x</a>').includes('href="/about"'))
    assert.ok(sanitizeHtml('<a href="../up">x</a>').includes('href="../up"'))
    assert.ok(sanitizeHtml('<a href="#anchor">x</a>').includes('href="#anchor"'))
  })

  test('images keep their dimensions and alt text', () => {
    const out = sanitizeHtml('<img src="/a.png" alt="A" width="10" height="20" loading="lazy">')
    assert.ok(out.includes('src="/a.png"'))
    assert.ok(out.includes('alt="A"'))
    assert.ok(out.includes('width="10"'))
    assert.ok(out.includes('loading="lazy"'))
  })

  test('code blocks keep their language class', () => {
    const out = sanitizeHtml('<pre><code class="language-js">x</code></pre>')
    assert.ok(out.includes('class="language-js"'))
  })

  test('tables survive with alignment', () => {
    const out = sanitizeHtml('<table><thead><tr><th align="right">A</th></tr></thead></table>')
    assert.ok(out.includes('<table>'))
    assert.ok(out.includes('align="right"'))
  })

  test('a disallowed tag is unwrapped, not deleted with its text', () => {
    const out = sanitizeHtml('<p>keep <marquee>this text</marquee> please</p>')
    assert.ok(out.includes('this text'), 'text inside an unknown tag was lost')
    assert.ok(!out.includes('<marquee'))
  })

  test('a script element takes its contents with it', () => {
    const out = sanitizeHtml('<p>before</p><script>var payload = 1</script><p>after</p>')
    assert.ok(out.includes('before') && out.includes('after'))
    assert.ok(!out.includes('payload'), 'script body was left as visible text')
  })

  test('unclosed tags are closed', () => {
    const out = sanitizeHtml('<p>a<em>b')
    assert.equal(out, '<p>a<em>b</em></p>')
  })

  test('mismatched nesting is repaired rather than propagated', () => {
    const out = sanitizeHtml('<p><em>a</p></em>')
    assert.ok(out.startsWith('<p><em>a</em></p>'))
  })

  test('a target link gains noopener', () => {
    const out = sanitizeHtml('<a href="https://x.com" target="_blank">x</a>')
    assert.ok(out.includes('rel="noopener noreferrer"'))
  })

  test('text is escaped, not passed through', () => {
    assert.equal(sanitizeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d')
  })

  test('sanitizing twice changes nothing', () => {
    // The parser escapes as it renders and this runs over its output, so a
    // sanitizer that escaped again would turn every `<` in a code block into a
    // visible `&lt;`. Idempotence is what stops that.
    for (const input of [
      '<p>a &lt; b</p>',
      '<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>',
      '<p>Tom &amp; Jerry</p>',
      '<a href="/s?a=1&amp;b=2">x</a>',
      '<p>caf&eacute;</p>'
    ]) {
      const once = sanitizeHtml(input)
      assert.equal(sanitizeHtml(once), once, `not idempotent for ${input}`)
    }
  })

  test('escaped markup stays readable rather than becoming double-escaped', () => {
    const out = sanitizeHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')

    assert.ok(!out.includes('&amp;lt;'), `double-escaped: ${out}`)
    assert.ok(out.includes('&lt;script&gt;'), out)
    assert.ok(!out.includes('<script'), out)
  })

  test('null and undefined render as empty', () => {
    assert.equal(sanitizeHtml(null), '')
    assert.equal(sanitizeHtml(undefined), '')
  })
})

describe('allowlist configuration', () => {
  test('a narrowed allowlist drops everything else', () => {
    const out = sanitizeHtml('<p>a</p><h1>b</h1>', { allowed: { p: [] } })
    assert.ok(out.includes('<p>a</p>'))
    assert.ok(!out.includes('<h1>'))
    assert.ok(out.includes('b'), 'the heading text should survive as text')
  })

  test('a narrowed scheme list rejects the rest', () => {
    const out = sanitizeHtml('<a href="http://x.com">x</a>', { schemes: ['https'] })
    assert.ok(!out.includes('href='))
  })

  test('data: images stay off unless asked for', () => {
    const png = '<img src="data:image/png;base64,iVBORw0KGgo=">'
    assert.ok(!sanitizeHtml(png).includes('data:'))
    assert.ok(sanitizeHtml(png, { allowDataImages: true }).includes('data:image/png'))
  })

  test('a data: SVG is refused even when data images are allowed', () => {
    // An SVG is a document that can carry script, so it is an image in name only.
    const svg = '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">'
    assert.ok(!sanitizeHtml(svg, { allowDataImages: true }).includes('data:'))
  })

  test('style is refused even when an allowlist asks for it', () => {
    // Allowing CSS means allowing a URL loader, an element positioned over a
    // real control, and an element hidden from view. Deciding which
    // declarations are safe needs a CSS parser, so none of them are.
    const out = sanitizeHtml('<p style="position:fixed;top:0">x</p>', {
      allowed: { p: ['style'] }
    })

    assert.ok(!/\sstyle\s*=/i.test(out), out)
  })

  test('a URL is judged by its decoded form, not its spelling', () => {
    // `javascript&#58;alert(1)` is not a scheme until the entity is decoded.
    // Attribute escaping also defends this, so the check is a second layer —
    // but it is the layer that survives someone changing the escaping.
    const out = sanitizeHtml('<a href="javascript&#58;alert(1)">x</a>')
    assert.ok(!out.includes('href='), out)

    const hex = sanitizeHtml('<a href="&#x6A;avascript:alert(1)">x</a>')
    assert.ok(!hex.includes('href='), hex)
  })

  test('the default allowlist names no event handler', () => {
    for (const [tag, attrs] of Object.entries(DEFAULT_ALLOWED)) {
      for (const attr of attrs) {
        assert.ok(!attr.startsWith('on'), `${tag} allows the handler ${attr}`)
      }
    }
  })
})

describe('isSafeUrl', () => {
  test('permits the schemes a document needs', () => {
    for (const url of ['https://x.com', 'http://x.com', 'mailto:a@b.co', 'tel:+15551234']) {
      assert.ok(isSafeUrl(url), url)
    }
  })

  test('permits relative URLs of every shape', () => {
    for (const url of ['/a', './a', '../a', 'a.png', '#frag', '?q=1', '//cdn.example/x', '']) {
      assert.ok(isSafeUrl(url), url)
    }
  })

  test('a colon inside a path is not a scheme', () => {
    // Read naively, "foo)" and "2024" look like schemes and these get refused.
    assert.ok(isSafeUrl('foo):bar'))
    assert.ok(isSafeUrl('/files/a:b'))
    assert.ok(isSafeUrl('./2024:notes'))
  })

  test('refuses script-bearing schemes however they are spelled', () => {
    const bad = [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      '\tjavascript:alert(1)',
      '\njavascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      ' javascript:alert(1)',
      ' javascript:alert(1)',
      '﻿javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd'
    ]

    for (const url of bad) assert.ok(!isSafeUrl(url), `allowed: ${JSON.stringify(url)}`)
  })

  test('a non-string is never safe', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      assert.equal(isSafeUrl(value), false)
    }
  })
})

describe('entities', () => {
  test('decodes named, decimal and hex forms', () => {
    assert.equal(decodeEntities('&amp;'), '&')
    assert.equal(decodeEntities('&#65;'), 'A')
    assert.equal(decodeEntities('&#x41;'), 'A')
    assert.equal(decodeEntities('&ouml;'), 'ö')
  })

  test('leaves unknown names alone rather than guessing', () => {
    assert.equal(decodeEntities('&notareal;'), '&notareal;')
  })

  test('rejects numeric references that are too long to be one', () => {
    assert.equal(decodeEntities('&#87654321;'), '&#87654321;')
  })

  test('replaces out-of-range and surrogate code points', () => {
    // A lone surrogate is not a character, and emitting one produces a string
    // that breaks JSON encoding further down.
    assert.equal(decodeEntities('&#xD800;'), '�')
    assert.equal(decodeEntities('&#x110000;'), '�')
    assert.equal(decodeEntities('&#0;'), '�')
  })

  test('decoding runs before the scheme check, not after', () => {
    // This is the whole reason decodeEntities exists in the URL path.
    assert.equal(decodeEntities('&#x6A;avascript:alert(1)'), 'javascript:alert(1)')
    assert.ok(!isSafeUrl(decodeEntities('&#x6A;avascript:alert(1)')))
  })
})

describe('escapeHtml and stripTags', () => {
  test('escapes every character that could start markup', () => {
    assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;')
  })

  test('stripTags removes markup and script bodies', () => {
    assert.equal(stripTags('<p>Hello <b>world</b></p>'), 'Hello world')
    assert.equal(stripTags('<script>evil()</script>text'), 'text')
  })

  test('stripTags decodes what it leaves behind', () => {
    assert.equal(stripTags('<p>a &amp; b</p>'), 'a & b')
  })
})
