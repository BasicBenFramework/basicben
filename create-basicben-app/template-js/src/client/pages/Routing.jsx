import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

export function Routing() {
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
        title="Routing"
        subtitle="API routes, controllers, and middleware"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">Route Files</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Routes live in <code>src/routes/</code>. Each file default-exports a function that receives the router and registers routes on it. The loader scans the directory recursively at startup and calls that function for every <code>.js</code> file it finds.
          </p>
          <p className={`text-sm ${t.muted} mb-4`}>
            The loader only calls a default export when it is a function. A file that default-exports anything else, such as an array of route objects, is skipped without an error or a warning. If a route returns 404 that you are certain you registered, check that the file exports a function.
          </p>

          <CodeBlock title="src/routes/api/posts.js">
{`import { PostController } from '../../controllers/PostController.js'
import { auth } from '../../middleware/auth.js'

export default (router) => {
  // Public routes
  router.get('/api/feed', PostController.feed)
  router.get('/api/feed/:id', PostController.feedShow)

  // Authenticated routes
  router.get('/api/posts', auth, PostController.index)
  router.post('/api/posts', auth, PostController.store)
  router.get('/api/posts/:id', auth, PostController.show)
  router.put('/api/posts/:id', auth, PostController.update)
  router.delete('/api/posts/:id', auth, PostController.destroy)
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The router supports <code>get</code>, <code>post</code>, <code>put</code>, <code>patch</code>, <code>delete</code>, <code>head</code> and <code>options</code>, plus <code>all</code> to register a path for every method.
          </p>

          <CodeBlock title="Generate a route file">
{`npx basicben make:route post`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Controllers</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Controllers hold the logic for your routes. Each handler receives the request and the response and is responsible for sending something back.
          </p>

          <CodeBlock title="src/controllers/PostController.js">
{`import { db } from '@basicbenframework/core/db'

export const PostController = {
  // GET /api/posts
  index: async (req, res) => {
    const posts = await (await db.table('posts'))
      .where('user_id', req.userId)
      .orderBy('created_at', 'DESC')
      .get()

    res.json({ posts })
  },

  // GET /api/posts/:id
  show: async (req, res) => {
    const post = await (await db.table('posts')).find(req.params.id)

    if (!post || post.user_id !== req.userId) {
      return res.json({ error: 'Post not found' }, 404)
    }

    res.json({ post })
  },

  // POST /api/posts
  store: async (req, res) => {
    const { title, content } = req.body

    const result = await (await db.table('posts')).insert({
      title,
      content,
      user_id: req.userId
    })

    res.json({ id: result.lastInsertRowid }, 201)
  },

  // PUT /api/posts/:id
  update: async (req, res) => {
    const { title, content } = req.body

    await (await db.table('posts'))
      .where('id', req.params.id)
      .where('user_id', req.userId)
      .update({ title, content })

    res.json({ success: true })
  },

  // DELETE /api/posts/:id
  destroy: async (req, res) => {
    await (await db.table('posts'))
      .where('id', req.params.id)
      .where('user_id', req.userId)
      .delete()

    res.json({ success: true })
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>db.table()</code> resolves the database connection before it hands back a query builder, so it is awaited once before the chain starts. That is the reason for the doubled <code>await</code>.
          </p>

          <CodeBlock title="Generate a controller">
{`npm run make:controller Post`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Middleware</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Middleware is positional. Pass it between the path and the handler: the last argument is always the handler, and everything before it runs first, in order. A middleware either calls <code>next()</code> to continue or sends a response to stop the chain.
          </p>

          <CodeBlock title="Attaching middleware to a route">
{`router.get('/api/posts', auth, PostController.index)
router.post('/api/posts', auth, rateLimit, PostController.store)`}
          </CodeBlock>

          <CodeBlock title="src/middleware/auth.js">
{`import { verifyJwt } from '@basicbenframework/core/auth'

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
  next()
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Files in <code>src/middleware/</code> that default-export a function are loaded automatically and applied to every request, in alphabetical order. Middleware you want to apply to specific routes should be a named export instead, as above, and passed to the route explicitly.
          </p>

          <CodeBlock title="Generate middleware">
{`npx basicben make:middleware auth`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Route Groups</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>router.group()</code> shares a path prefix and a set of middleware across several routes. Middleware passed to the group runs before the middleware of any route inside it.
          </p>

          <CodeBlock title="Grouping routes">
{`export default (router) => {
  router.group('/api/admin', auth, requireAdmin, (group) => {
    group.get('/stats', AdminController.stats)
    group.get('/users', AdminController.users)
    group.get('/users/:id', AdminController.showUser)
  })
}

// Registers, each behind auth and requireAdmin:
//   GET /api/admin/stats
//   GET /api/admin/users
//   GET /api/admin/users/:id`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Named Routes</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Pass a name as a string directly after the path to register the route under that name. <code>router.route()</code> then builds a URL from the name and its parameters, so paths are defined in one place rather than repeated as string literals.
          </p>

          <CodeBlock title="Naming a route and generating its URL">
{`router.get('/api/users/:id/posts', 'users.posts', PostController.byUser)

router.route('users.posts', { id: 42 })
// => '/api/users/42/posts'`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The name is picked out by type, not by position: of the arguments between the path and the handler, the first string is the name and the rest are middleware. Both orderings below register the same named route. Put the name straight after the path anyway — it reads better, and it is where the next person will look for it.
          </p>

          <CodeBlock title="The name can sit anywhere among the middleware">
{`router.get('/api/posts/:id', 'posts.show', auth, PostController.show)
router.get('/api/posts/:id', auth, 'posts.show', PostController.show)

// Both give:
router.route('posts.show', { id: 42 })
// => '/api/posts/42'`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Before 0.1.17 only the first argument after the path was checked, so a name placed after middleware stayed in the middleware chain and was called as a function at request time. If you are on an older version, keep the name immediately after the path.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            Asking for a name that was never registered throws, so a renamed route fails at the call site instead of quietly producing a broken URL.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Resource Routes</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>router.resource()</code> registers the five standard CRUD routes for a controller. It only registers a route when the matching method exists on the controller, so a controller without a <code>destroy</code> method simply gets no DELETE route.
          </p>

          <CodeBlock title="Registering a resource">
{`router.resource('/api/widgets', WidgetController)

// GET    /api/widgets       -> index     (api.widgets.index)
// GET    /api/widgets/:id   -> show      (api.widgets.show)
// POST   /api/widgets       -> create    (api.widgets.create)
// PUT    /api/widgets/:id   -> update    (api.widgets.update)
// DELETE /api/widgets/:id   -> destroy   (api.widgets.destroy)`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Route names are derived from the path. Pass <code>name</code> to set them explicitly and <code>only</code> to limit which routes are generated.
          </p>

          <CodeBlock title="Resource options">
{`router.resource('/api/widgets', WidgetController, {
  name: 'widgets',
  only: ['index', 'show']
})

// GET /api/widgets      -> widgets.index
// GET /api/widgets/:id  -> widgets.show`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Pass <code>middleware</code> to put every generated route behind it. Wrapping the resource in a group does the same thing and is the better choice when other routes share the same guard.
          </p>

          <CodeBlock title="Middleware on a resource">
{`// Directly on the resource
router.resource('/api/widgets', WidgetController, {
  name: 'widgets',
  middleware: [auth]
})

// Or through a group, which other routes can share
router.group('/api', auth, (group) => {
  group.resource('/widgets', WidgetController, { name: 'widgets' })
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The <code>middleware</code> option was unusable before 0.1.17, when the generated route name was still read positionally: the option placed the middleware ahead of the name, which left the name in the chain and made every route in the resource fail with a 500. On an older version, use the group.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Route Parameters</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Path segments written as <code>:name</code> are captured into <code>req.params</code>. Query strings are parsed into <code>req.query</code>, and the pathname is available as <code>req.path</code>. Both params and query values are always strings.
          </p>

          <CodeBlock title="Parameters and query strings">
{`// Route: /api/posts/:id
// URL:   /api/posts/123?include=author

export const show = async (req, res) => {
  const { id } = req.params        // { id: '123' }
  const { include } = req.query    // { include: 'author' }

  req.path                         // '/api/posts/123'
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            A trailing <code>/*</code> matches everything below a path and captures the remainder as <code>req.params._catchAll</code>.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Request Body</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            JSON request bodies are parsed automatically and made available on <code>req.body</code>. The body parser is enabled by default with a 1mb limit, configurable through <code>bodyParser</code> in <code>basicben.config.js</code>.
          </p>

          <CodeBlock title="Accessing the request body">
{`export const store = async (req, res) => {
  const { title, content, published } = req.body

  if (!title) {
    return res.json({ error: 'Title is required' }, 400)
  }

  // ...
}`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Response Helpers</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Every response object carries four helpers.
          </p>

          <CodeBlock title="Sending responses">
{`res.json({ posts })              // 200 with a JSON body
res.json({ error: 'Gone' }, 410) // status and JSON body together
res.send('plain text')           // text, or JSON if given an object
res.redirect('/login')           // 302 by default
res.redirect('/login', 301)      // or an explicit status
res.status(204)                  // sets the status, returns res`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Both ways of setting a status work. <code>res.json()</code> applies its second argument when you pass one and otherwise keeps whatever <code>res.status()</code> already set, so an explicit second argument wins over an earlier <code>res.status()</code> call.
          </p>

          <CodeBlock title="Either form">
{`res.json({ error: 'Not found' }, 404)   // 404
res.status(404).json({ error: 'Not found' })  // 404`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Before 0.1.15 <code>res.json()</code> defaulted its status to 200 and applied it unconditionally, so <code>res.status(404).json(...)</code> answered 200. Passing the code to <code>res.json()</code> directly is correct on every version, which is why the examples here do it that way.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Client Routing</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The browser side has its own router. <code>createClientApp()</code> takes a map of paths to components and returns a React component to render. A path maps either to a component directly, or to an object that can also set a layout and a guard.
          </p>

          <CodeBlock title="src/routes/App.jsx">
{`import { createClientApp } from '@basicbenframework/core/client'
import { AppLayout } from '../client/layouts/AppLayout'
import { AuthLayout } from '../client/layouts/AuthLayout'
import { Home } from '../client/pages/Home'
import { Auth } from '../client/pages/Auth'
import { Posts } from '../client/pages/Posts'
import { PostForm } from '../client/pages/PostForm'

export default createClientApp({
  layout: AppLayout,
  routes: {
    '/': Home,
    '/login': { component: Auth, layout: AuthLayout, guest: true },
    '/posts': { component: Posts, auth: true },
    '/posts/:id/edit': { component: PostForm, auth: true }
  }
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>auth: true</code> redirects to <code>/login</code> when nobody is signed in. <code>guest: true</code> does the reverse and redirects to <code>/</code> when someone is, which keeps signed-in users off the login page. <code>layout</code> replaces the app-wide <code>layout</code> for that route only.
          </p>

          <CodeBlock title="Hooks">
{`import { useAuth, useNavigate, useParams, usePath } from '@basicbenframework/core/client'

export function EditPost() {
  const { user, logout, loading } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams()
  const path = usePath()

  // navigate('/posts')
  // navigate('/posts', { replace: true })
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            These hooks read context that <code>createClientApp</code> provides, so they throw if called from a component rendered outside it.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Deep Links in Production</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            In production the server serves the built client from <code>static.dir</code>. A request for <code>/posts/1</code> looks for a file at that path, finds none, and returns 404, so the client router never gets a chance to run. Deep links and page refreshes break even though the same URLs work in development.
          </p>
          <p className={`text-sm ${t.muted} mb-4`}>
            Setting <code>spa: true</code> serves <code>index.html</code> for unmatched routes instead, letting the client router take over.
          </p>

          <CodeBlock title="basicben.config.js">
{`export default {
  static: {
    dir: 'public',
    spa: true
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The fallback runs only after route matching, so it cannot shadow your API. Requests under <code>/api/</code> and requests for files with a non-HTML extension still return 404, which means a missing script reports as missing rather than returning the app shell with the wrong content type. Available from 0.1.14.
          </p>
        </Card>
      </div>
    </div>
  )
}
