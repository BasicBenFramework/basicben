/**
 * Categories and tags are searched and added from the same field.
 *
 * The editor presented its two taxonomies as two unrelated controls.
 * Categories were a checkbox list in a 12rem scrolling window with an "+ Add
 * New Category" disclosure under it; tags were a free-text field with every
 * existing tag folded away behind "Choose from existing tags". Neither had a
 * way to find anything: on a site with eighty categories the box you want is
 * forty rows down, and on one with four hundred tags the disclosure is a wall.
 *
 * Both are one control now — chips for what is on the post, a search field, the
 * list it filters, and an "+ Add" that appears only when what you typed does
 * not already exist. Making the search field the add field is the half that
 * matters: you cannot type the name of a tag you already have without being
 * shown it, which is how a taxonomy stops collecting near-duplicates.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

const picker = read('src/client/components/admin/TermPicker.tsx')
const editor = read('src/client/pages/admin/PostEditor.tsx')
const layout = read('src/client/layouts/AdminLayout.tsx')

describe('the field searches', () => {
  test('typing filters the list', () => {
    assert.match(picker, /terms\.filter\(term => term\.name\.toLowerCase\(\)\.includes\(needle\)\)/)

    // An empty query is not a filter that matches nothing.
    assert.match(picker, /needle \? terms\.filter/)
  })

  test('it is a search field, above the list it filters', () => {
    assert.match(picker, /type="search"/)
    assert.ok(
      picker.indexOf('admin-term-search') < picker.indexOf('admin-term-list'),
      'the field is below the list it filters'
    )
  })

  test('a search that matches nothing says so, and still offers to add it', () => {
    assert.match(picker, /No matches for/)
    assert.match(picker, /\{typed && !exact && \(/)
  })
})

describe('the same field adds', () => {
  test('a name that already exists is selected, not created again', () => {
    // Case-insensitively: "Privacy" and "privacy" are one tag to everyone
    // except a database, and offering to create the second is how you get both.
    assert.match(picker, /terms\.find\(term => term\.name\.toLowerCase\(\) === needle\)/)
    assert.match(picker, /if \(exact\) \{\s*\n\s*if \(!selected\.includes\(exact\.id\)\) onToggle\(exact\.id\)/)
  })

  test('add is only offered when there is nothing that matches exactly', () => {
    const add = picker.slice(picker.indexOf('{typed && !exact && ('))

    assert.match(add.slice(0, add.indexOf('</button>')), /\+ Add/)
  })

  test('the field clears once the term is on the post', () => {
    // Otherwise the list stays filtered to the thing you just added, which
    // reads as though nothing else exists.
    assert.strictEqual(picker.split("setQuery('')").length - 1, 3)
  })

  test('Enter adds the term rather than saving the post', () => {
    // The picker sits inside the post form. A bare Enter in a text input
    // submits it, so the draft would save halfway through a word.
    const key = picker.slice(picker.indexOf('onKeyDown={e => {'))

    assert.match(key.slice(0, key.indexOf('}}')), /e\.preventDefault\(\)/)
  })
})

describe('both taxonomies use it', () => {
  test('categories and tags are the same control', () => {
    assert.strictEqual(editor.split('<TermPicker').length - 1, 2)
    assert.match(editor, /onAdd=\{createCategory\}/)
    assert.match(editor, /onAdd=\{addTags\}/)
  })

  test('a comma still commits a tag, and does not commit a category', () => {
    // A run of tags is conventionally typed comma-separated, and addTags
    // splits it. Category names contain commas often enough to matter.
    assert.match(picker, /commitOnComma && e\.key === ','/)
    assert.match(picker, /commitOnComma = false/)

    const tags = editor.slice(editor.indexOf('title="Tags"'))
    const categories = editor.slice(
      editor.indexOf('title="Categories"'),
      editor.indexOf('title="Tags"')
    )

    assert.match(tags.slice(0, tags.indexOf('/>')), /commitOnComma/)
    assert.doesNotMatch(categories, /commitOnComma/)
  })

  test('adding a tag reuses an existing one rather than making a second', () => {
    // The picker matches what is typed whole; addTags matches each name in a
    // comma-separated run, which is the case the picker cannot see.
    assert.match(editor, /allTags\.find\(t => t\.name\.toLowerCase\(\) === name\.toLowerCase\(\)\)/)
  })

  test('the tag list is no longer folded away behind a disclosure', () => {
    assert.doesNotMatch(editor, /admin-term-details/)
    assert.doesNotMatch(editor, /Choose from existing tags/)

    // And the rules it needed went with it, rather than sitting in the
    // stylesheet matching nothing.
    assert.doesNotMatch(layout, /admin-term-details/)
    assert.doesNotMatch(layout, /admin-inline-add/)
  })

  test('the add button is styled, and says so while it is working', () => {
    assert.match(layout, /\.admin-term-search \{/)
    assert.match(layout, /\.admin-term-add:disabled \{/)
    assert.match(picker, /disabled=\{busy\}/)
  })
})
