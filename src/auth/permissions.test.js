/**
 * Tests for roles and capabilities
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  ROLES,
  DEFAULT_ROLE,
  can,
  capabilitiesFor,
  isValidRole,
  requireCapability,
  requireRole,
  requireAdminArea
} from './permissions.js'

const admin = { id: 1, role: ROLES.ADMIN }
const editor = { id: 2, role: ROLES.EDITOR }
const author = { id: 3, role: ROLES.AUTHOR }
const contributor = { id: 4, role: ROLES.CONTRIBUTOR }
const subscriber = { id: 5, role: ROLES.SUBSCRIBER }

/** Minimal res double capturing the json() call */
function mockRes() {
  return {
    body: null,
    status: null,
    json(body, status = 200) { this.body = body; this.status = status; return this }
  }
}

describe('can', () => {
  test('admin holds every capability', () => {
    assert.ok(can(admin, 'settings.manage'))
    assert.ok(can(admin, 'post.delete'))
    assert.ok(can(admin, 'anything.invented'))
  })

  test('editor manages content but not settings', () => {
    assert.ok(can(editor, 'post.publish'))
    assert.ok(can(editor, 'comment.moderate'))
    assert.strictEqual(can(editor, 'settings.manage'), false)
    assert.strictEqual(can(editor, 'plugin.manage'), false)
  })

  test('author edits only their own posts', () => {
    assert.ok(can(author, 'post.edit', { user_id: 3 }))
    assert.strictEqual(can(author, 'post.edit', { user_id: 99 }), false)
  })

  test('editor edits anyone\'s posts', () => {
    assert.ok(can(editor, 'post.edit', { user_id: 99 }))
  })

  test('ownership check needs a resource', () => {
    assert.strictEqual(can(author, 'post.edit'), false)
  })

  test('ownership reads author_id and userId too', () => {
    assert.ok(can(author, 'post.edit', { author_id: 3 }))
    assert.ok(can(author, 'post.edit', { userId: 3 }))
  })

  test('ownership compares across string and number ids', () => {
    assert.ok(can(author, 'post.edit', { user_id: '3' }))
  })

  test('contributor cannot publish', () => {
    assert.ok(can(contributor, 'post.create'))
    assert.strictEqual(can(contributor, 'post.publish'), false)
  })

  test('contributor cannot upload media', () => {
    assert.strictEqual(can(contributor, 'media.upload'), false)
  })

  test('subscriber can only comment', () => {
    assert.ok(can(subscriber, 'comment.create'))
    assert.strictEqual(can(subscriber, 'post.create'), false)
  })

  test('rejects a missing or roleless user', () => {
    assert.strictEqual(can(null, 'post.create'), false)
    assert.strictEqual(can({ id: 1 }, 'post.create'), false)
  })

  test('unknown role holds nothing', () => {
    assert.strictEqual(can({ id: 1, role: 'wizard' }, 'comment.create'), false)
  })
})

describe('roles', () => {
  test('new users default to the least privileged role', () => {
    assert.strictEqual(DEFAULT_ROLE, ROLES.SUBSCRIBER)
    assert.strictEqual(can({ id: 1, role: DEFAULT_ROLE }, 'settings.manage'), false)
  })

  test('isValidRole', () => {
    assert.ok(isValidRole('admin'))
    assert.strictEqual(isValidRole('wizard'), false)
  })

  test('capabilitiesFor returns [] for an unknown role', () => {
    assert.deepStrictEqual(capabilitiesFor('wizard'), [])
  })
})

describe('requireCapability', () => {
  test('401 when unauthenticated', async () => {
    const res = mockRes()
    let advanced = false
    await requireCapability('post.create')({}, res, () => { advanced = true })

    assert.strictEqual(res.status, 401)
    assert.strictEqual(advanced, false)
  })

  test('403 when the capability is missing', async () => {
    const res = mockRes()
    let advanced = false
    await requireCapability('settings.manage')({ user: editor }, res, () => { advanced = true })

    assert.strictEqual(res.status, 403)
    assert.strictEqual(advanced, false)
  })

  test('passes when the capability is held', async () => {
    const res = mockRes()
    let advanced = false
    await requireCapability('post.publish')({ user: editor }, res, () => { advanced = true })

    assert.strictEqual(advanced, true)
  })

  test('loadResource enables the ownership check', async () => {
    const res = mockRes()
    let advanced = false
    const mw = requireCapability('post.edit', {
      loadResource: async () => ({ id: 10, user_id: 3 })
    })
    await mw({ user: author }, res, () => { advanced = true })

    assert.strictEqual(advanced, true)
  })

  test('403 when the resource belongs to someone else', async () => {
    const res = mockRes()
    let advanced = false
    const mw = requireCapability('post.edit', {
      loadResource: async () => ({ id: 10, user_id: 99 })
    })
    await mw({ user: author }, res, () => { advanced = true })

    assert.strictEqual(res.status, 403)
    assert.strictEqual(advanced, false)
  })

  test('404 when the resource is missing', async () => {
    const res = mockRes()
    const mw = requireCapability('post.edit', { loadResource: async () => null })
    await mw({ user: author }, res, () => {})

    assert.strictEqual(res.status, 404)
  })
})

describe('requireRole', () => {
  test('allows a listed role', () => {
    const res = mockRes()
    let advanced = false
    requireRole(ROLES.ADMIN, ROLES.EDITOR)({ user: editor }, res, () => { advanced = true })

    assert.strictEqual(advanced, true)
  })

  test('rejects an unlisted role', () => {
    const res = mockRes()
    requireRole(ROLES.ADMIN)({ user: editor }, res, () => {})

    assert.strictEqual(res.status, 403)
  })
})

describe('requireAdminArea', () => {
  test('subscribers are kept out', () => {
    const res = mockRes()
    requireAdminArea()({ user: subscriber }, res, () => {})

    assert.strictEqual(res.status, 403)
  })

  test('contributors are let in', () => {
    const res = mockRes()
    let advanced = false
    requireAdminArea()({ user: contributor }, res, () => { advanced = true })

    assert.strictEqual(advanced, true)
  })

  test('unauthenticated requests are rejected', () => {
    const res = mockRes()
    requireAdminArea()({}, res, () => {})

    assert.strictEqual(res.status, 401)
  })
})
