import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

export function Database() {
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
        title="Database"
        subtitle="Drivers, migrations, seeding, and the query builder"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">Drivers</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            There are two drivers: <code>sqlite</code> and <code>postgres</code>
            (<code>pg</code> is an accepted alias). Anything else throws
            <code>Unknown database driver</code> when the connection is opened. Configure
            the one you want in <code>basicben.config.js</code>.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 mb-4">
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">SQLite</div>
              <p className={`text-xs mt-1 ${t.muted}`}>
                The default. Uses Node's built-in <code>node:sqlite</code>, so there is
                nothing to install — but it needs Node 24 or newer.
              </p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">PostgreSQL</div>
              <p className={`text-xs mt-1 ${t.muted}`}>
                Uses <code>pg</code>, an optional dependency. Run <code>npm install pg</code>
                if it is not already present.
              </p>
            </div>
          </div>

          <CodeBlock title="basicben.config.js — SQLite (default)">
{`export default {
  db: {
    driver: 'sqlite',
    url: './database.sqlite'
  }
}`}
          </CodeBlock>

          <CodeBlock title="basicben.config.js — Postgres">
{`export default {
  db: {
    driver: 'postgres',
    url: process.env.DATABASE_URL,
    poolSize: 10          // optional, defaults to 10
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The connection string is taken from <code>db.url</code>, then
            <code>process.env.DATABASE_URL</code>, then <code>./database.sqlite</code>. Leaving
            <code>db</code> out of the config entirely gives you a local SQLite file, which is
            why a new project works before you have configured anything.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            The connection is a single cached instance for the life of the process. The first
            call opens it; every later call reuses it.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Hosted Databases</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            There is no adapter for any hosted provider specifically. What works is decided by
            wire protocol, not by branding.
          </p>

          <div className="space-y-3">
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">Neon — works</div>
              <p className={`text-xs mt-1 ${t.muted}`}>
                Neon speaks the Postgres wire protocol, so use
                <code>driver: 'postgres'</code> with the connection string Neon gives you.
                Setting <code>driver: 'neon'</code> throws.
              </p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">Supabase, RDS, and other Postgres hosts — works</div>
              <p className={`text-xs mt-1 ${t.muted}`}>
                Same as Neon: <code>driver: 'postgres'</code> and their connection string.
              </p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">Turso and libSQL — not yet</div>
              <p className={`text-xs mt-1 ${t.muted}`}>
                An HTTP libSQL adapter is planned but not shipped. <code>driver: 'turso'</code>
                throws today.
              </p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <div className="font-semibold text-sm">PlanetScale — not supported</div>
              <p className={`text-xs mt-1 ${t.muted}`}>
                PlanetScale is MySQL. There is no MySQL driver, and MySQL is not a goal.
              </p>
            </div>
          </div>

          <CodeBlock title="Neon, Supabase, or any Postgres host">
{`export default {
  db: {
    driver: 'postgres',
    url: process.env.DATABASE_URL
  }
}`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Migrations</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A migration is a file in <code>migrations/</code> that exports <code>up</code> and
            <code>down</code>. Both receive the database adapter and run raw SQL through
            <code>db.exec()</code>. There is no schema builder — you write the SQL your
            database understands.
          </p>

          <CodeBlock title="Generate a migration">
{`npm run make:migration create_posts
# Creates: migrations/<timestamp>_create_posts.js`}
          </CodeBlock>

          <CodeBlock title="migrations/001_create_posts.js">
{`export const up = async (db) => {
  await db.exec(\`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      published INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  \`)
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS posts')
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Files run in filename order, and each run is recorded in a <code>_migrations</code>
            table along with a batch number. A rollback undoes the whole last batch in reverse
            order, so if one <code>migrate</code> applied five files, one rollback removes all
            five.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npm run migrate</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Run pending migrations</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npm run migrate:rollback</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Undo the last batch</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npm run migrate:fresh</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Drop every table and migrate again</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npm run migrate:status</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Show which files have run</p>
            </div>
          </div>

          <p className={`text-sm ${t.muted} mt-4`}>
            The generated stub and the migrations that ship with a new project are written in
            SQLite dialect. If you are targeting Postgres, translate as you go:
            <code>INTEGER PRIMARY KEY AUTOINCREMENT</code> becomes <code>SERIAL PRIMARY KEY</code> or
            <code>GENERATED ALWAYS AS IDENTITY</code>, and <code>DATETIME</code> becomes
            <code>TIMESTAMP</code>. Nothing rewrites SQL for you.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Seeding</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Seeds populate a database with starting data. Each file in <code>seeds/</code>
            exports a <code>seed</code> function (a default export also works), and files run in
            filename order, which is why they are usually numbered.
          </p>

          <CodeBlock title="seeds/01_users.js">
{`import { db } from '@basicbenframework/core/db'
import { hashPassword } from '@basicbenframework/core/auth'

export async function seed() {
  const password = await hashPassword('password123')

  await (await db.table('users')).insert({
    name: 'Admin User',
    email: 'admin@example.com',
    password
  })

  console.log('Seeded 1 user')
}`}
          </CodeBlock>

          <CodeBlock title="seeds/02_posts.js">
{`import { db } from '@basicbenframework/core/db'

export async function seed() {
  const user = await (await db.table('users')).first()

  await (await db.table('posts')).insert({
    user_id: user.id,
    title: 'Welcome to BasicBen',
    content: 'Your first post.',
    published: 1
  })
}`}
          </CodeBlock>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npm run seed</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Run every seed file</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npx basicben seed 01_users</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Run one file, named without the extension</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npx basicben make:seed users</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Generate seeds/users.js</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npx basicben db:seed</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Alias for seed</p>
            </div>
          </div>

          <p className={`text-sm ${t.muted} mt-4`}>
            Seeds are not tracked the way migrations are, so running them twice runs them
            twice. Against a table with a unique constraint the second run fails, which is
            usually what you want to notice.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Query Builder</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>query(table)</code> and <code>db.table(table)</code> both return a builder,
            and both are async because they open the connection first. That is where the
            double await in these examples comes from: the outer one waits for the query, the
            inner one waits for the builder.
          </p>

          <CodeBlock title="Reading">
{`import { db, query } from '@basicbenframework/core/db'

// Every row
const users = await (await query('users')).get()

// One row by id, or undefined
const user = await (await query('users')).find(1)

// Two arguments mean equals
const admins = await (await query('users'))
  .where('is_admin', 1)
  .get()

// Three arguments take an operator
const recent = await (await query('posts'))
  .where('published', 1)
  .where('id', '>', 100)
  .orderBy('created_at', 'DESC')
  .limit(10)
  .get()

// first() adds LIMIT 1 and returns the row itself
const latest = await (await query('posts'))
  .orderBy('created_at', 'DESC')
  .first()

// db.table() is the same builder under a different name
const drafts = await (await db.table('posts')).where('published', 0).get()`}
          </CodeBlock>

          <CodeBlock title="Writing">
{`const result = await (await query('posts')).insert({
  user_id: 1,
  title: 'My Post',
  content: 'Hello world'
})

result.lastInsertRowid   // id of the new row
result.changes           // 1

await (await query('posts'))
  .where('id', postId)
  .update({ title: 'Updated Title' })

await (await query('posts'))
  .where('id', postId)
  .delete()`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            On Postgres, <code>insert()</code> appends <code>RETURNING id</code> so
            <code>lastInsertRowid</code> is filled in there too. A hand-written
            <code>INSERT</code> without that clause returns <code>null</code> instead, which is a
            good reason to insert through the builder.
          </p>

          <CodeBlock title="Counting and paging">
{`const total = await (await query('posts'))
  .where('published', 1)
  .count()

const taken = await (await query('users'))
  .where('email', 'test@example.com')
  .exists()

const page = await (await query('posts'))
  .orderBy('created_at', 'DESC')
  .paginate(1, 15)

// { data, total, page, perPage, totalPages }`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The full method list is short by design.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              { name: 'select(...cols)', desc: 'Columns to return; defaults to *' },
              { name: 'where(col, val)', desc: 'Equality shorthand' },
              { name: 'where(col, op, val)', desc: '=, !=, <, >, <=, >=, LIKE, IN and friends' },
              { name: 'whereNull(col)', desc: 'IS NULL' },
              { name: 'whereNotNull(col)', desc: 'IS NOT NULL' },
              { name: 'orderBy(col, dir)', desc: 'ASC or DESC' },
              { name: 'limit(n) / offset(n)', desc: 'Slice the result' },
              { name: 'get() / first()', desc: 'All rows, or the first one' },
              { name: 'find(id)', desc: 'Shorthand for where(\'id\', id).first()' },
              { name: 'insert(data)', desc: 'Returns { lastInsertRowid, changes }' },
              { name: 'update(data) / delete()', desc: 'Return { lastInsertRowid, changes }' },
              { name: 'count() / exists()', desc: 'A number, and whether it is above zero' },
              { name: 'paginate(page, perPage)', desc: 'Rows plus the totals to render a pager' },
              { name: 'only(...) / except(...)', desc: 'Mass assignment rules, below' },
              { name: 'toSql()', desc: 'The SELECT this builder would run' },
            ].map(({ name, desc }) => (
              <div key={name} className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
                <code className="text-sm font-semibold">{name}</code>
                <p className={`text-xs mt-1 ${t.muted}`}>{desc}</p>
              </div>
            ))}
          </div>

          <p className={`text-sm ${t.muted} mt-4`}>
            Multiple <code>where</code> calls are joined with <code>AND</code>. Table and column
            names are validated against <code>[a-zA-Z_][a-zA-Z0-9_]*</code> and quoted, and every
            value goes in as a bound parameter, so user input cannot become SQL.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Booleans on SQLite</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>node:sqlite</code> refuses to bind JavaScript booleans. Passing
            <code>true</code> or <code>false</code> as a value throws
            <code>Provided value cannot be bound to SQLite parameter</code>, whether it came
            from an insert or a where clause. Store flags as integers and convert at the edge.
          </p>

          <CodeBlock title="Use 1 and 0">
{`// Throws on SQLite
await (await query('posts')).insert({ title: 'Draft', published: false })
await (await query('posts')).where('published', true).get()

// Works
await (await query('posts')).insert({ title: 'Draft', published: 0 })
await (await query('posts')).where('published', 1).get()

// Convert where the value arrives, not everywhere it is used
await (await query('posts')).insert({
  title: req.body.title,
  published: req.body.published ? 1 : 0
})`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Mass Assignment Protection</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>only()</code> lists the columns a write may touch; <code>except()</code> lists
            the ones it may not. Anything excluded is dropped silently rather than raising, so a
            request body with extra fields still succeeds — minus the fields it should not have
            set. <code>id</code> is blocked by default.
          </p>

          <CodeBlock title="Whitelist with only()">
{`await (await query('users'))
  .only('name', 'email', 'bio')
  .insert(req.body)

// Given { name: 'Bob', email: 'bob@test.com', is_admin: 1 }
// the row is written without is_admin`}
          </CodeBlock>

          <CodeBlock title="Blacklist with except()">
{`await (await query('users'))
  .except('id', 'is_admin', 'created_at')
  .where('id', userId)
  .update(req.body)`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Prefer <code>only()</code>. A whitelist stays correct when someone adds a column
            later; a blacklist quietly stops covering everything.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">What the Builder Does Not Do</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The list above is all of it. There is no <code>join</code>, no
            <code>whereIn</code>, no <code>orWhere</code>, no <code>groupBy</code>, and no
            aggregate beyond <code>count()</code>. This is deliberate: a builder that covers
            every query ends up as large as the SQL it hides. When you need more, write SQL.
          </p>

          <CodeBlock title="A join is a raw query">
{`import { db } from '@basicbenframework/core/db'

const posts = await db.all(
  \`SELECT posts.*, users.name AS author
     FROM posts
     JOIN users ON users.id = posts.user_id
    WHERE posts.published = ?
    ORDER BY posts.created_at DESC
    LIMIT 5\`,
  [1]
)`}
          </CodeBlock>

          <CodeBlock title="So is IN, with one placeholder per value">
{`const ids = [1, 2, 3]
const placeholders = ids.map(() => '?').join(', ')

const users = await db.all(
  \`SELECT * FROM users WHERE id IN (\${placeholders})\`,
  ids
)`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Build placeholders from the array length and pass the values separately, never by
            interpolating the values themselves.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Raw Queries</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The adapter is available directly for anything the builder does not cover.
          </p>

          <CodeBlock title="db.all, db.get, db.run, db.exec">
{`import { db } from '@basicbenframework/core/db'

// Many rows
const posts = await db.all(
  'SELECT * FROM posts WHERE user_id = ? AND published = ?',
  [userId, 1]
)

// One row, or undefined
const user = await db.get('SELECT * FROM users WHERE email = ?', [email])

// Writes: { lastInsertRowid, changes }
const result = await db.run(
  'INSERT INTO posts (title, user_id) VALUES (?, ?)',
  [title, userId]
)

// Statements with no parameters, such as DDL
await db.exec('CREATE INDEX idx_posts_user ON posts (user_id)')`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Raw SQL reaches the driver exactly as written, so the placeholder style is yours to
            get right: <code>?</code> on SQLite, <code>$1</code>, <code>$2</code> on Postgres.
            The builder handles that difference for you, which is one more reason to use it for
            ordinary queries and save raw SQL for the queries that need it.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Transactions</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>db.transaction()</code> wraps the callback in <code>BEGIN</code> and
            <code>COMMIT</code>, rolls back if it throws, and returns whatever the callback
            returns. The callback receives a transaction-scoped adapter, and its result is
            awaited before the commit, so async work inside is safe.
          </p>

          <CodeBlock title="Transferring between two rows">
{`const remaining = await db.transaction(async (tx) => {
  await tx.run(
    'UPDATE accounts SET balance = balance - ? WHERE id = ?',
    [100, fromId]
  )
  await tx.run(
    'UPDATE accounts SET balance = balance + ? WHERE id = ?',
    [100, toId]
  )

  const row = await tx.get('SELECT balance FROM accounts WHERE id = ?', [fromId])
  return row.balance
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Use <code>tx</code> inside the callback rather than <code>db</code>. On Postgres the
            transaction holds one pooled client, and a statement sent through <code>db</code>
            takes a different connection — it would commit on its own and survive the rollback.
            The <code>tx</code> object exposes <code>run</code>, <code>get</code>,
            <code>all</code> and <code>exec</code>; the query builder does not accept it, so
            transactional work is written in SQL.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Models</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A model here is a plain object that groups the queries for one table. There is no
            base class to extend, no active record, no relations, and no lazy loading — a model
            has exactly the methods you write.
          </p>

          <p className={`text-sm ${t.muted} mb-4`}>
            <code>npx basicben make:model Post</code> scaffolds one with a
            <code>fillable</code> list and <code>all</code>, <code>find</code>,
            <code>create</code>, <code>update</code> and <code>destroy</code> built on the query
            builder. Check the import at the top of anything you generate: it should read
            <code>@basicbenframework/core/db</code>. Older scaffolds import from
            <code>'basicben'</code>, which is not a published package and will not resolve.
          </p>

          <CodeBlock title="src/models/Post.js">
{`import { getDb, query } from '@basicbenframework/core/db'

// Columns update() may write. Without this, passing req.body straight
// through would let a caller set any column at all.
const UPDATABLE = ['title', 'content', 'published']

export const Post = {
  async find(id) {
    const db = await getDb()
    return db.get('SELECT * FROM posts WHERE id = ?', [id])
  },

  // A join has to be raw SQL, so this lives on the model rather than
  // being reassembled at every call site.
  async findPublished() {
    const db = await getDb()
    return db.all(\`
      SELECT posts.*, users.name AS author_name
        FROM posts
        JOIN users ON users.id = posts.user_id
       WHERE posts.published = 1
       ORDER BY posts.created_at DESC
    \`)
  },

  async create(data) {
    // Through the builder so Postgres gets RETURNING id and the new
    // id comes back.
    const posts = await query('posts')
    const result = await posts.insert({
      user_id: data.user_id,
      title: data.title,
      content: data.content,
      published: data.published ? 1 : 0
    })
    return { id: result.lastInsertRowid, ...data }
  },

  async update(id, data) {
    const fields = Object.keys(data).filter(k => UPDATABLE.includes(k))
    if (fields.length === 0) return this.find(id)

    return (await query('posts'))
      .only(...UPDATABLE)
      .where('id', id)
      .update(data)
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Controllers then call <code>Post.create(...)</code> instead of assembling queries
            themselves, which keeps the column list in one file.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Validating Against the Database</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Two validation rules query the database. Both are async, so the
            <code>validate</code> call must be awaited like any other.
          </p>

          <CodeBlock title="unique and exists">
{`import { validate, rules } from '@basicbenframework/core/validation'

const result = await validate(req.body, {
  // No other row in users has this email
  email: [rules.required, rules.email, rules.unique('users')],

  // Check a named column instead of the field name
  slug: [rules.unique('categories', 'slug')],

  // The referenced row must exist
  user_id: [rules.required, rules.exists('users')]
})`}
          </CodeBlock>

          <CodeBlock title="Ignoring the record being updated">
{`// Without the third argument, a user saving their profile without
// changing their email would collide with themselves.
email: [rules.required, rules.email, rules.unique('users', 'email', currentUserId)]`}
          </CodeBlock>
        </Card>
      </div>
    </div>
  )
}
