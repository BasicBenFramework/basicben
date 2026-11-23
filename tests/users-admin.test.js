/**
 * The Users screen and invitations, checked against the source.
 *
 * The failures worth guarding against here are the quiet ones: a route that
 * forgot its capability check, a write that can leave the site with no admin,
 * or an invitation that the registration switch silently shuts. None of them
 * show up as a type error or a crash — each is a line missing from a file —
 * so the checks read the files.
 *
 * The behaviour itself was exercised against a scratch SQLite database:
 * demoting, disabling and deleting the last admin all came back 409, and an
 * invitation accepted with DISABLE_REGISTRATION=true produced a signed-in
 * account with the invited role.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

/** Every router.<verb>('<path>', ...) line in a route file, as `VERB path -> rest`. */
function routesIn(path) {
  return [...read(path).matchAll(/router\.(get|post|put|patch|delete)\('([^']+)',\s*([^\n]+)\)/g)].map(
    ([, verb, route, rest]) => ({ verb: verb.toUpperCase(), route, rest })
  )
}

/** The body of one method in a controller object, up to the next method. */
function method(source, name) {
  const start = source.indexOf(`async ${name}(`)
  assert.ok(start !== -1, `${name} should exist`)
  const next = source.indexOf('\n  async ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

describe('the users API', () => {
  const routes = routesIn('src/routes/api/users.ts')
  const file = read('src/routes/api/users.ts')
  const controller = read('src/controllers/UserController.ts')

  test('is registered with the server, since route autoloading is off', () => {
    const server = read('src/server/index.ts')

    assert.match(server, /import usersRoutes from '\.\.\/routes\/api\/users'/)
    assert.match(server, /^usersRoutes\(router\)$/m)
  })

  test('every management route is auth then user.manage', () => {
    assert.match(file, /const manage = \[auth, requireCapability\('user\.manage'\)\]/)

    const managed = routes.filter(({ route }) => !route.startsWith('/api/invitations/:token'))
    assert.ok(managed.length >= 8, `only found ${managed.length} managed routes`)

    for (const { verb, route, rest } of managed) {
      assert.match(rest, /^\.\.\.manage,/, `${verb} ${route} is not behind user.manage`)
    }
  })

  test('only the invitation link itself is public', () => {
    const open = routes.filter(({ rest }) => !rest.startsWith('...manage'))

    assert.deepStrictEqual(
      open.map(({ verb, route }) => `${verb} ${route}`).sort(),
      ['GET /api/invitations/:token', 'POST /api/invitations/:token/accept']
    )
  })

  test('invite is registered before /api/users/:id and is rate limited', () => {
    assert.ok(file.indexOf("'/api/users/invite'") < file.indexOf("'/api/users/:id'"))
    assert.match(file, /'\/api\/users\/invite', \.\.\.manage, invitationLimit,/)
  })

  test('the last active admin cannot be demoted, disabled or deleted', () => {
    // Enforced in the statement, not by counting first: two admins demoting
    // each other at once would both count two and leave none.
    assert.match(controller, /const KEEPS_AN_ADMIN = `\(/)
    assert.match(controller, /others\.role = 'admin' AND others\.disabled_at IS NULL AND others\.id != \?/)

    for (const name of ['update', 'disable', 'destroy']) {
      const body = method(controller, name)
      assert.match(body, /\$\{KEEPS_AN_ADMIN\}/, `${name} writes without the last-admin guard`)
      assert.match(body, /LAST_ADMIN \}, 409/, `${name} does not refuse with 409`)
    }
  })

  test('an admin cannot demote, disable or delete themselves', () => {
    for (const name of ['update', 'disable', 'destroy']) {
      assert.match(method(controller, name), /id === req\.userId/, `${name} lets an admin lock themselves out`)
    }
  })

  test('a role change validates the role and ends their sessions', () => {
    const body = method(controller, 'update')

    assert.match(body, /isValidRole\(role\)/)
    assert.match(body, /await revokeSessions\(id\)/)
    assert.ok(
      body.indexOf('changed.changes') < body.indexOf('revokeSessions(id)'),
      'sessions should end only once the change has actually been made'
    )
  })

  test('disabling ends their sessions', () => {
    assert.match(method(controller, 'disable'), /await revokeSessions\(id\)/)
  })

  test('the listing pages, searches and filters', () => {
    const body = method(controller, 'index')

    assert.match(body, /paginationFrom\(req\.query\)/)
    assert.match(body, /meta\(page, perPage, total\)/)
    assert.match(body, /LOWER\(users\.name\) LIKE \? ESCAPE/)
    assert.match(body, /LOWER\(users\.email\) LIKE \? ESCAPE/)
    assert.match(body, /isValidRole\(role\)/)
    assert.match(body, /ORDER BY users\.created_at DESC, users\.id DESC/)
    assert.match(controller, /post_count: Number\(row\.post_count/)
  })

  test('never returns a password', () => {
    assert.doesNotMatch(controller.slice(controller.indexOf('const SELECT_USERS')), /users\.password|SELECT \* FROM users/)
  })

  test('deleting someone with posts requires somewhere to put them', () => {
    const body = method(controller, 'destroy')

    assert.match(body, /postCount > 0 && !reassignTo/)
    assert.match(body, /UPDATE posts SET user_id = \? WHERE user_id = \?/)
    assert.match(body, /db\.transaction\(/, 'the reassignment and the delete must commit together')
  })

  test('deleting removes their credentials explicitly', () => {
    const body = method(controller, 'destroy')

    for (const table of ['api_tokens', 'auth_tokens', 'user_two_factor', 'user_credentials']) {
      assert.match(body, new RegExp(`DELETE FROM ${table} WHERE user_id = \\?`), `${table} rows are left behind`)
    }
  })
})

describe('invitations', () => {
  const controller = read('src/controllers/UserController.ts')

  test('reuse auth_tokens with a kind of their own', () => {
    assert.match(controller, /export const INVITATION_KIND = 'invitation'/)
    assert.match(controller, /issueToken\(req\.userId!, INVITATION_KIND/)
    assert.match(controller, /INVITATION_TTL = 7 \* 24 \* 60 \* 60 \* 1000/)
  })

  test('refuse an address that already has an account', () => {
    assert.match(method(controller, 'store'), /User\.findByEmail\(email\)/)
  })

  test('email a link to the accept page, from a template of their own', () => {
    assert.match(controller, /\/invite\/\$\{token\}/)
    assert.match(controller, /renderMail\('invitation'/)
    assert.ok(existsSync(join(ROOT, 'mail/invitation.txt')))
    assert.ok(existsSync(join(ROOT, 'mail/invitation.html')))
    assert.match(read('mail/invitation.html'), /\{\{inviteUrl\}\}/)
  })

  test('accepting is not subject to DISABLE_REGISTRATION', () => {
    // On a closed site an invitation is the only way in. The switch belongs
    // to self-service sign-up, which this is not.
    assert.doesNotMatch(controller, /process\.env\.DISABLE_REGISTRATION/)
    assert.doesNotMatch(read('src/routes/api/users.ts'), /DISABLE_REGISTRATION ===/)
  })

  test('accepting spends the token atomically and verifies the address', () => {
    const body = method(controller, 'accept')

    assert.match(body, /redeemToken\(token, INVITATION_KIND\)/)
    assert.match(body, /email_verified: 1/)
    assert.match(body, /issueSessionToken\(/)
    assert.ok(
      body.indexOf('hashPassword(') < body.indexOf('redeemToken('),
      'the slow hash should run before the token is spent'
    )
  })

  test('showing an invitation does not spend it', () => {
    const body = method(controller, 'show')

    assert.match(body, /peekInvitation\(/)
    assert.doesNotMatch(body, /redeemToken/)
  })
})

describe('the Users screen', () => {
  const app = read('src/routes/App.tsx')
  const layout = read('src/client/layouts/AdminLayout.tsx')
  const admin = read('src/controllers/AdminController.ts')

  test('is routed', () => {
    assert.match(app, /'\/admin\/users': \{ component: AdminUsers, layout: NoLayout, auth: true \}/)
  })

  test('is in the menu only for someone who can manage users', () => {
    for (const source of [layout, admin]) {
      assert.match(source, /path: '\/admin\/users'[^}]*capability: 'user\.manage'/)
    }

    assert.match(admin, /!item\.capability \|\| can\(req\.user/)
    assert.match(layout, /!item\.capability \|\| can\(user/)
  })

  test('has an icon', () => {
    assert.match(read('src/client/components/admin/AdminIcons.tsx'), /'\/admin\/users': 'users'/)
  })

  test('asks where the posts go before deleting someone who has them', () => {
    const page = read('src/client/pages/admin/Users.tsx')

    assert.match(page, /\?reassign=/)
    assert.match(page, /target\.post_count === 0/)
  })

  test('the accept page is reachable with the public site and sign-up both off', () => {
    const auth = app.slice(app.indexOf('const authRoutes'))

    assert.match(auth, /'\/invite\/:token': \{ component: AcceptInvite/)
    // Inside authRoutes, before the registration guard — not in publicRoutes,
    // which DISABLE_PUBLIC_SITE empties.
    assert.ok(auth.indexOf("'/invite/:token'") < auth.indexOf('__DISABLE_REGISTRATION__'))
    assert.ok(app.indexOf('const publicRoutes') < app.indexOf('const authRoutes'))
  })

  test('the accept page stores the session the way sign-in does', () => {
    const page = read('src/client/pages/AcceptInvite.tsx')

    assert.match(page, /localStorage\.setItem\('token', data\.token\)/)
    assert.match(page, /setUser\(data\.user\)/)
    assert.match(page, /navigate\('\/admin'\)/)
  })
})
