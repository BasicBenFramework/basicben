import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

export function Authentication() {
  const { t } = useTheme()

  const CodeBlock = ({ children, title }) => (
    <div className="mt-4">
      {title && <div className={`text-xs font-medium mb-2 ${t.muted}`}>{title}</div>}
      <div className={`rounded-lg p-4 font-mono text-sm ${t.card} border ${t.border} overflow-x-auto`}>
        <pre className={t.text}>{children}</pre>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Authentication"
        subtitle="JWT tokens, password hashing, protected routes, and roles"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">Overview</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Authentication is built on <code>node:crypto</code> — there is no bcrypt or
            jsonwebtoken dependency. Token and password helpers come from
            <code>@basicbenframework/core/auth</code>, and roles come from
            <code>@basicbenframework/core/auth/permissions</code>.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">JWT Tokens</div>
              <p className={`text-xs mt-1 ${t.muted}`}>Stateless authentication, signed HS256</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">Scrypt Hashing</div>
              <p className={`text-xs mt-1 ${t.muted}`}>Salted password storage</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">Roles and Capabilities</div>
              <p className={`text-xs mt-1 ${t.muted}`}>Decide who may do what</p>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">The Signing Secret</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The framework does not hold a secret of its own and reads nothing from
            <code>basicben.config.js</code> for auth. Every call that signs or verifies a token
            takes the secret as an argument, so you decide where it comes from. The convention
            across the generated app is <code>process.env.APP_KEY</code>, set in <code>.env</code>.
          </p>

          <CodeBlock title=".env">
{`APP_KEY=a-long-random-string`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Passing the secret explicitly means signing and verification cannot silently drift
            apart, and a route that mints tokens for a different audience can use a different key.
            Changing <code>APP_KEY</code> invalidates every token already issued, which is the
            blunt way to sign everybody out.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Password Hashing</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Passwords are hashed with scrypt. Each hash gets its own random salt, and verification
            uses a timing-safe comparison. Both <code>hashPassword</code> and
            <code>verifyPassword</code> are async, so both need <code>await</code>.
          </p>

          <CodeBlock title="Hash and verify passwords">
{`import { hashPassword, verifyPassword } from '@basicbenframework/core/auth'

// Registration: hash before storing
const hash = await hashPassword('correct-horse-battery-staple')

// Login: compare the submitted password against the stored hash
const isValid = await verifyPassword('correct-horse-battery-staple', hash)
// true

await verifyPassword('wrong-password', hash)
// false`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The stored value is a single string holding the salt, the derived key, and the
            parameters used to produce it, in the format
            <code>base64(salt):base64(hash):N:r:p:keylen</code>. Because the parameters travel with
            the hash, raising the cost later does not lock existing users out — old hashes still
            verify against their own settings. A <code>TEXT</code> column is all you need.
          </p>

          <CodeBlock title="Raising the cost over time">
{`import { hashPassword, verifyPassword, needsRehash } from '@basicbenframework/core/auth'

// After a successful login, while you still have the plain password
if (await verifyPassword(password, user.password) && needsRehash(user.password)) {
  await User.update(user.id, { password: await hashPassword(password) })
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>needsRehash</code> compares the parameters stored in the hash against the current
            defaults, or against options you pass as a second argument. It is the only one of the
            three that is synchronous.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">JWT Tokens</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>signJwt</code> and <code>verifyJwt</code> are synchronous. There is nothing to
            await, and no try/catch to write: <code>verifyJwt</code> returns the decoded payload,
            or <code>null</code> when the token is missing, malformed, signed with another secret,
            or expired.
          </p>

          <CodeBlock title="Sign and verify">
{`import { signJwt, verifyJwt } from '@basicbenframework/core/auth'

// After checking a password
const token = signJwt(
  { userId: user.id, role: user.role },
  process.env.APP_KEY,
  { expiresIn: '7d' }
)

// Later, on an incoming request
const payload = verifyJwt(token, process.env.APP_KEY)

if (!payload) {
  // No token, wrong signature, or expired — treat as signed out
}

payload.userId // 1
payload.role   // 'admin'
payload.iat    // issued at, seconds since the epoch
payload.exp    // expires at, present only when expiresIn was given`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>expiresIn</code> takes a number of seconds, or a string with a unit:
            <code>'60s'</code>, <code>'5m'</code>, <code>'2h'</code>, <code>'7d'</code>. Leave it
            out and the token never expires, which is rarely what you want. Tokens are signed
            HS256, and <code>signJwt</code> throws when the secret is missing rather than signing
            with an empty key.
          </p>

          <CodeBlock title="Reading a token without verifying it">
{`import { decodeJwt } from '@basicbenframework/core/auth'

// Returns the payload of any well-formed token, signature unchecked
const payload = decodeJwt(token)`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>decodeJwt</code> is for logging and debugging — reading the user id out of an
            expired token, for instance. It proves nothing about the token, so never make an
            access decision from its result.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            The payload is signed, not encrypted. Anyone holding the token can read it, so put
            identifiers in it and keep secrets out.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Registration</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A registration endpoint validates the input, stores a hash rather than the password,
            and returns a token so the new user is signed in immediately.
          </p>

          <CodeBlock title="src/controllers/AuthController.js">
{`import { query } from '@basicbenframework/core/db'
import { validate, rules } from '@basicbenframework/core/validation'
import { hashPassword, signJwt } from '@basicbenframework/core/auth'
import { ROLES, DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'

export const AuthController = {
  async register(req, res) {
    const result = await validate(req.body, {
      name: [rules.required, rules.min(2)],
      email: [rules.required, rules.email, rules.unique('users')],
      password: [rules.required, rules.min(8)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, email, password } = req.body

    // The first account to register is the operator setting the site up, so it
    // becomes the admin. Everyone after gets the least privileged role.
    const isFirstUser = (await (await query('users')).count()) === 0
    const role = isFirstUser ? ROLES.ADMIN : DEFAULT_ROLE

    const { lastInsertRowid } = await (await query('users')).insert({
      name,
      email,
      password: await hashPassword(password),
      role
    })

    const token = signJwt({ userId: lastInsertRowid, role }, process.env.APP_KEY, {
      expiresIn: '7d'
    })

    return res.json({ user: { id: lastInsertRowid, name, email, role }, token }, 201)
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The role is decided on the server from the number of existing users. Never read it out
            of <code>req.body</code> — that would let anyone register as an administrator.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Login</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Login looks the user up, compares the password against the stored hash, and issues a
            token carrying the user id and role.
          </p>

          <CodeBlock title="src/controllers/AuthController.js">
{`import { query } from '@basicbenframework/core/db'
import { verifyPassword, signJwt } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'

export const AuthController = {
  async login(req, res) {
    const { email, password } = req.body

    if (!email || !password) {
      return res.json({ error: 'Email and password required' }, 400)
    }

    const user = await (await query('users')).where('email', email).first()

    // One message for both failures, so the response does not reveal which
    // addresses have accounts.
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.json({ error: 'Invalid credentials' }, 401)
    }

    const role = user.role ?? DEFAULT_ROLE

    const token = signJwt({ userId: user.id, role }, process.env.APP_KEY, {
      expiresIn: '7d'
    })

    return res.json({
      user: { id: user.id, name: user.name, email: user.email, role },
      token
    })
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>res.json(data, status)</code> takes the status code as a second argument.
            <code>res.status(status).json(data)</code> works too — use whichever reads better.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Auth Middleware</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The middleware pulls the token off the <code>Authorization</code> header, verifies it,
            and puts the result on the request. Everything downstream reads <code>req.user</code>
            instead of touching the token again.
          </p>

          <CodeBlock title="src/middleware/auth.js">
{`import { verifyJwt } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'

// Named export only, deliberately. See the note below.
export const auth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.json({ error: 'Unauthorized' }, 401)
  }

  const payload = verifyJwt(token, process.env.APP_KEY)
  if (!payload) {
    return res.json({ error: 'Invalid token' }, 401)
  }

  req.userId = payload.userId
  req.user = { id: payload.userId, role: payload.role ?? DEFAULT_ROLE }
  next()
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Export it as <code>auth</code>, not as the default. Any <em>default</em> export from a
            file in <code>src/middleware/</code> is loaded automatically and applied to every
            request in the application. Default-exporting this function would therefore demand a
            valid token for the login endpoint, the registration endpoint, and every public page —
            an app that returns 401 to everyone, including the people trying to sign in. Reserve
            default exports for middleware that genuinely belongs on every request, such as request
            logging.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            Verifying a token costs nothing but an HMAC, so this middleware does not touch the
            database. When a handler needs the full record, load it there from
            <code>req.userId</code>. Loading the user on every request also picks up a role change
            immediately, which the token alone will not do.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Protecting Routes</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A route file default-exports a function that receives the router. Middleware goes
            between the path and the handler, and runs before it.
          </p>

          <CodeBlock title="src/routes/api/posts.js">
{`import { PostController } from '../../controllers/PostController.js'
import { auth } from '../../middleware/auth.js'

export default (router) => {
  // Public
  router.get('/api/feed', PostController.feed)
  router.get('/api/feed/:id', PostController.feedShow)

  // Requires a valid token
  router.get('/api/posts', auth, PostController.index)
  router.post('/api/posts', auth, PostController.store)
  router.put('/api/posts/:id', auth, PostController.update)
  router.delete('/api/posts/:id', auth, PostController.destroy)
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            It has to be a function. The loader imports each file under
            <code>src/routes/</code> and calls the default export only when it is a function, so a
            file that default-exports an array of route objects registers nothing and reports no
            error — the endpoints simply return 404. If a route you just added cannot be reached,
            check the shape of the export first.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Roles and Capabilities</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Authentication says who the user is; capabilities say what they may do. Roles ship with
            a fixed set of capabilities named <code>resource.action</code>, and handlers ask about
            the capability rather than the role — so the check keeps working if the roles are
            rearranged later.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { role: 'admin', desc: 'Everything, including settings, users, themes and plugins' },
              { role: 'editor', desc: 'Create, edit, publish and delete any post or page' },
              { role: 'author', desc: 'Create and publish posts, edit and delete their own' },
              { role: 'contributor', desc: 'Write and edit their own drafts, but not publish or upload media' },
              { role: 'subscriber', desc: 'Comment only. The default for new accounts' },
            ].map(({ role, desc }) => (
              <div key={role} className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
                <code className="text-sm font-semibold">{role}</code>
                <p className={`text-xs mt-1 ${t.muted}`}>{desc}</p>
              </div>
            ))}
          </div>

          <CodeBlock title="Checking a capability">
{`import { can } from '@basicbenframework/core/auth/permissions'

can(req.user, 'settings.manage')   // true only for admin
can(req.user, 'post.create')       // true from contributor upward

// Ownership-scoped capabilities need the record being acted on
can(req.user, 'post.edit', post)`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            A role may hold the <code>.own</code> variant of an action instead of the plain one.
            An author holds <code>post.edit.own</code>, so <code>can(user, 'post.edit', post)</code>
            is true for their own post and false for someone else&rsquo;s. Ownership is read from
            the record&rsquo;s <code>user_id</code>, <code>author_id</code> or <code>userId</code>,
            whichever is present. Without a record to compare against, an ownership-scoped
            capability cannot be granted, so the check returns false — pass the resource whenever
            there is one.
          </p>

          <CodeBlock title="Gating a route on a capability">
{`import { requireCapability, requireRole, ROLES } from '@basicbenframework/core/auth/permissions'
import { PostController } from '../../controllers/PostController.js'
import { UserController } from '../../controllers/UserController.js'
import { auth } from '../../middleware/auth.js'
import { Post } from '../../models/Post.js'

export default (router) => {
  // 403 unless the user may edit this particular post
  router.put(
    '/api/posts/:id',
    auth,
    requireCapability('post.edit', { loadResource: (req) => Post.find(req.params.id) }),
    PostController.update
  )

  // Role check, where a capability does not fit
  router.get('/api/admin/users', auth, requireRole(ROLES.ADMIN), UserController.index)
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>requireCapability</code> reads <code>req.user</code>, so it always goes after
            <code>auth</code>. It answers 401 when there is no user and 403 when the capability is
            missing. Given a <code>loadResource</code> function it loads the record first, answers
            404 if there is none, and otherwise leaves it on <code>req.resource</code> for the
            handler — so the row is fetched once, not twice.
          </p>

          <CodeBlock title="Everything a role holds">
{`import { capabilitiesFor, ROLES, DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'

capabilitiesFor(ROLES.ADMIN)
// ['*']

capabilitiesFor(ROLES.CONTRIBUTOR)
// ['post.create', 'post.edit.own', 'post.delete.own', 'comment.create']

DEFAULT_ROLE
// 'subscriber'`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The first account to register becomes the admin, on the assumption that it belongs to
            whoever is setting the site up. Everyone after that gets <code>DEFAULT_ROLE</code>.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            The role travels in the token, which is what makes these checks free. The cost is that
            promoting or demoting a user changes nothing until their token is reissued. Where that
            delay matters — revoking an administrator, say — reload the user in the handler and
            pass the fresh record to <code>can()</code> rather than trusting
            <code>req.user</code>.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">On the Client</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>useAuth</code> exposes the signed-in user and the two functions that change that
            state. The token lives in <code>localStorage</code> under <code>token</code>; on
            startup the router sends it to <code>/api/user</code> to find out who it belongs to,
            and <code>loading</code> is true until that answer arrives.
          </p>

          <CodeBlock title="Reading the current user">
{`import { useAuth } from '@basicbenframework/core/client'

export function Profile() {
  const { user, logout, loading } = useAuth()

  if (loading) return null
  if (!user) return null

  return (
    <div>
      <p>{user.name} ({user.role})</p>
      <button onClick={logout}>Sign out</button>
    </div>
  )
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            After a successful login, store the token and hand the user to <code>setUser</code>.
            The <code>api</code> helper reads the token back out of <code>localStorage</code> and
            sends it as an <code>Authorization: Bearer</code> header on later requests.
          </p>

          <CodeBlock title="Signing in">
{`import { useAuth, useNavigate } from '@basicbenframework/core/client'
import { api } from '../../helpers/api'

export function Login() {
  const { setUser } = useAuth()
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()

    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })

    localStorage.setItem('token', data.token)
    setUser(data.user)
    navigate('/')
  }

  // ...
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>logout</code> does the reverse: it clears the token, forgets the user, and
            returns to the home page.
          </p>

          <CodeBlock title="src/routes/App.jsx">
{`export const App = createClientApp({
  routes: {
    '/': Home,

    // Signed out only — a signed-in visitor is sent to /
    '/login': { component: Auth, layout: AuthLayout, guest: true },
    '/register': { component: Auth, layout: AuthLayout, guest: true },

    // Signed in only — a signed-out visitor is sent to /login
    '/posts': { component: Posts, auth: true },
    '/profile': { component: Profile, auth: true }
  }
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            These guards decide what to render, nothing more. They keep a signed-out visitor from
            landing on a page that has no data to show, but anyone can call your API directly, so
            every protected route still needs the <code>auth</code> middleware on the server.
          </p>
        </Card>
      </div>
    </div>
  )
}
