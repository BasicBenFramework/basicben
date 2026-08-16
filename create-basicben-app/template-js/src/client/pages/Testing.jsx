import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

export function Testing() {
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
        title="Testing"
        subtitle="Running tests with Vitest, and what the framework leaves to you"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">How Tests Run</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>npm test</code> runs <code>basicben test</code>, which hands off to Vitest with
            <code>--run</code> — one pass, then exit. Vitest picks up files matching
            <code>*.test.js</code> and <code>*.spec.js</code> anywhere in the project, and reads
            <code>vite.config.js</code>, so there is nothing else to configure to get started.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npm test</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Run every test once</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npm test -- src/models</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Only files matching a path fragment</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npm test -- --watch</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Re-run on change</p>
            </div>
            <div className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
              <code className="text-sm font-semibold">npx vitest</code>
              <p className={`text-xs mt-1 ${t.muted}`}>Vitest directly, skipping the CLI wrapper</p>
            </div>
          </div>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>test</code> is the only test script in <code>package.json</code>. There is no
            <code>test:watch</code>, <code>test:coverage</code> or <code>test:ui</code> — the
            arguments after <code>--</code> are what npm forwards, and everything below is a flag
            rather than a script of its own.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">What the Framework Does Not Provide</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            There is no testing module. Alongside the package root there are twenty-one entry
            points — <code>server</code>, <code>client</code>, <code>db</code>,{' '}
            <code>auth</code>, <code>validation</code>, <code>content</code>,{' '}
            <code>storage</code>, <code>mail</code>, <code>hooks</code>, <code>plugins</code>,{' '}
            <code>themes</code>, <code>rate-limit</code>, <code>updates</code>, and the{' '}
            <code>auth/*</code>,{' '}
            <code>storage/*</code>, <code>plugins/*</code> and <code>themes/*</code> families —
            and not one of them is for tests. No test client, no request builder, no database
            reset helper, no model factories.
          </p>

          <p className={`text-sm ${t.muted} mb-4`}>
            Less of that is missing than it first appears. Controllers are functions, so call
            them. Models are objects, so call them. The query builder works against any SQLite
            file, so a test can have one of its own. The part you do have to arrange yourself is
            HTTP-level testing: exercising routing and middleware end to end means starting a
            server and using <code>fetch</code> against it.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">A Plain Test</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Test files sit next to the code they cover, or under <code>tests/</code> if you
            prefer them apart. Anything Vitest exports is available: <code>describe</code>,
            <code>it</code>, <code>expect</code>, <code>beforeEach</code>, <code>vi</code> for
            mocks.
          </p>

          <CodeBlock title="src/utils/helpers.test.js">
{`import { describe, it, expect } from 'vitest'
import { slugify } from './helpers.js'

describe('slugify', () => {
  it('converts text to a slug', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('removes punctuation', () => {
    expect(slugify('Hello! World?')).toBe('hello-world')
  })
})`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Testing a Controller</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A controller action is an ordinary <code>async (req, res)</code> function, so a test
            can call it with objects you build by hand. Only the properties the action actually
            reads need to exist, which for most actions is <code>body</code>,
            <code>params</code> and whatever your auth middleware attaches.
          </p>

          <CodeBlock title="tests/PostController.test.js">
{`import { describe, it, expect } from 'vitest'
import { PostController } from '../src/controllers/PostController.js'

// res is whatever the controller calls. json(data, status) is the only
// method these paths use, so a small stub is enough.
function mockRes() {
  const sent = {}
  return {
    sent,
    json(data, status = 200) {
      sent.data = data
      sent.status = status
    }
  }
}

describe('PostController.store', () => {
  it('returns 422 when the body fails validation', async () => {
    const res = mockRes()

    await PostController.store({ body: { title: 'x' }, userId: 1 }, res)

    expect(res.sent.status).toBe(422)
    expect(res.sent.data.errors.title).toBeDefined()
    expect(res.sent.data.errors.content).toBeDefined()
  })
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            A validation failure returns before any query runs, so this test needs no database
            at all. Actions that do reach the database need the setup in the next section.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Testing Database Code</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Point the connection at a scratch SQLite file before the first query runs, and
            delete it afterwards. <code>resetDb()</code> drops the cached connection so the next
            call opens the file you just named, and creating the schema in
            <code>beforeAll</code> keeps each run independent of migration state.
          </p>

          <CodeBlock title="tests/posts.test.js">
{`import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import { db, query, resetDb } from '@basicbenframework/core/db'

const TEST_DB = './tests/test.sqlite'

function removeTestDb() {
  // WAL mode leaves two sidecar files next to the database.
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(TEST_DB + suffix)) unlinkSync(TEST_DB + suffix)
  }
}

beforeAll(async () => {
  removeTestDb()

  // basicben.config.js leaves db.url unset, so DATABASE_URL decides
  // the file. resetDb() clears any connection opened before this.
  process.env.DATABASE_URL = TEST_DB
  resetDb()

  await db.exec(\`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      published INTEGER DEFAULT 0
    )
  \`)
})

afterAll(async () => {
  await db.close()
  removeTestDb()
})

describe('posts', () => {
  it('inserts a row and reads it back', async () => {
    const result = await (await query('posts')).insert({ title: 'Hello', published: 1 })
    const post = await (await query('posts')).find(result.lastInsertRowid)

    expect(post.title).toBe('Hello')
  })

  it('drops columns that only() does not list', async () => {
    await (await query('posts')).only('title').insert({ title: 'Draft', published: 1 })
    const post = await (await query('posts')).where('title', 'Draft').first()

    expect(post.published).toBe(0)
  })

  it('rolls back when the transaction callback throws', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO posts (title) VALUES (?)', ['Rolled back'])
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(await (await query('posts')).where('title', 'Rolled back').count()).toBe(0)
  })
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Two things to watch. The connection is one cached instance per process, resolved
            once from <code>db.url</code> in <code>basicben.config.js</code> falling back to{' '}
            <code>DATABASE_URL</code> — the config wins. A project that sets it there will have
            its tests write to the development database instead, so set the test path in the
            config or leave <code>db.url</code> unset. And SQLite will not bind JavaScript
            booleans, so test data uses <code>1</code> and <code>0</code> like everything else.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            Vitest runs separate test files in parallel workers. Files that share one SQLite path
            will collide, so give each file its own database name, or keep database tests in a
            single file.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Coverage and the UI</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Both flags exist, and each needs a package that is not installed by default. Run
            either one without it and Vitest stops immediately with
            <code>MISSING DEPENDENCY</code>.
          </p>

          <CodeBlock title="Install first, then run">
{`npm install -D @vitest/coverage-v8
npm test -- --coverage

npm install -D @vitest/ui
npm test -- --ui`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Node's Test Runner</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The framework's own suite is written against <code>node:test</code> and
            <code>node:assert</code>, with no test dependency at all. You can write app tests the
            same way if you would rather not depend on Vitest — but run them with
            <code>node --test</code> directly, not through <code>npm test</code>.
          </p>

          <CodeBlock title="Run node:test files directly">
{`node --test tests/helpers.test.js
node --test --watch tests/
node --test --experimental-test-coverage tests/`}
          </CodeBlock>

          <CodeBlock title="A node:test file">
{`import { test, describe } from 'node:test'
import assert from 'node:assert'
import { slugify } from '../src/utils/helpers.js'

describe('slugify', () => {
  test('converts text to a slug', () => {
    assert.strictEqual(slugify('Hello World'), 'hello-world')
  })
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The two runners do not mix. Passing a <code>node:test</code> file to
            <code>npm test</code> fails with <code>No test suite found in file</code>, because
            the tests register with Node's runner and Vitest collects nothing. Pick one style per
            file, and if you use both, keep them in directories you can point each runner at.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Practices That Hold Up Here</h2>
          <div className="space-y-3 mt-4">
            {[
              {
                title: 'Give each test its own data',
                desc: 'There is no reset helper, so tests that assume an empty table break as soon as another test inserts. Create what you assert on, or assert on rows you inserted by name.'
              },
              {
                title: 'Test the model, not the query builder',
                desc: 'The builder has its own tests. What is worth covering is the SQL you wrote by hand, especially the joins the builder cannot express.'
              },
              {
                title: 'Cover validation failures',
                desc: 'The 422 path returns before any query, so it is the cheapest test in the suite and the one most likely to regress when a schema changes.'
              },
              {
                title: 'Keep the database out of unit tests',
                desc: 'Anything that is a pure function of its arguments should be tested as one. Reserve the SQLite fixture for code that genuinely queries.'
              },
              {
                title: 'Name tests after the behaviour',
                desc: 'The name is what you read when it fails, and "returns 422 when the body fails validation" tells you more at that moment than "store works".'
              },
            ].map(({ title, desc }) => (
              <div key={title} className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
                <div className="font-semibold text-sm">{title}</div>
                <p className={`text-xs mt-1 ${t.muted}`}>{desc}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
