/**
 * The markdown editor follows the theme, and its preview looks like prose.
 *
 * It did neither. Every colour was a hardcoded hex in an inline style — a
 * #f9fafb toolbar, #d1d5db borders, a #ffffff preview — and an inline style
 * cannot answer to a theme, so the editor stayed lit while the admin around it
 * went dark. The preview had no typography at all, so rendered HTML fell back
 * to browser defaults inside a page that resets them.
 *
 * Verified in a browser at the time: dark gives a preview of rgb(10,10,10) on
 * rgb(237,237,239), light gives rgb(250,250,250) on rgb(9,9,11), and the
 * heading, code block, blockquote and table all pick up real styling. These
 * tests keep the causes from coming back.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

function clientFiles(dir = 'src/client', found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`

    if (entry.isDirectory()) clientFiles(path, found)
    else if (entry.name.endsWith('.tsx')) found.push(path)
  }

  return found
}

describe('nothing hardcodes a colour it cannot theme', () => {
  test('no inline style sets a literal hex colour', () => {
    // The rule is about *inline* styles specifically: a hex in a stylesheet can
    // sit inside a [data-theme] block and change with the theme, but one in a
    // style={{}} is fixed for both.
    const literal = /(background|color|border)[A-Za-z]*: '#[0-9a-fA-F]{3,8}'/

    const offenders = clientFiles().filter((file) => literal.test(read(file)))

    assert.deepStrictEqual(
      offenders,
      [],
      'these set fixed colours inline; use a class and the theme variables'
    )
  })

  test('the editor styles itself with the same variables as the admin', () => {
    const styles = read('src/client/layouts/AdminLayout.tsx')
    const block = styles.slice(styles.indexOf('.markdown-editor-bar'))

    for (const token of ['var(--surface)', 'var(--border)', 'var(--fg)', 'var(--bg)']) {
      assert.ok(block.includes(token), `the editor should use ${token}`)
    }
  })
})

describe('the preview renders as prose', () => {
  const styles = read('src/client/layouts/AdminLayout.tsx')

  test('every block markdown produces is styled', () => {
    // Unstyled, these collapse into a wall of same-sized text: the thing that
    // made the preview not look like a preview.
    for (const element of ['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'th', 'img', 'hr', 'a']) {
      assert.ok(
        styles.includes(`.markdown-editor-preview ${element}`),
        `${element} has no styling in the preview`
      )
    }
  })

  test('code blocks scroll rather than widen the editor', () => {
    const pre = styles.slice(styles.indexOf('.markdown-editor-preview pre'))

    assert.match(pre.slice(0, 400), /overflow-x: auto/)
  })

  test('images are held to the width of the pane', () => {
    const img = styles.slice(styles.indexOf('.markdown-editor-preview img'))

    assert.match(img.slice(0, 200), /max-width: 100%/)
  })

  test('the first and last block do not add outer space', () => {
    // Otherwise the pane looks unevenly padded against its own border.
    assert.ok(styles.includes('.markdown-editor-preview > :first-child'))
    assert.ok(styles.includes('.markdown-editor-preview > :last-child'))
  })
})
