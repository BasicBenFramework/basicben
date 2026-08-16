import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

export function Validation() {
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
        title="Validation"
        subtitle="Request validation with built-in rules"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">Basic Usage</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Validate request data with the <code>validate</code> function and the built-in rules.
            It returns a result object — check it with <code>fails()</code> or <code>passes()</code>.
          </p>

          <CodeBlock title="Validating a request body">
{`import { validate, rules } from '@basicbenframework/core/validation'

export const store = async (req, res) => {
  const result = await validate(req.body, {
    title: [rules.required, rules.min(3), rules.max(100)],
    email: [rules.required, rules.email],
    age: [rules.required, rules.numeric, rules.min(18)]
  })

  if (result.fails()) {
    return res.json({ errors: result.errors }, 422)
  }

  // Data is valid, continue...
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Validation stops at the first failing rule for each field, so every field has at
            most one message. Messages interpolate the field name as written in the schema.
          </p>

          <CodeBlock title="Error response format">
{`{
  "errors": {
    "title": ["title must be at least 3 characters"],
    "email": ["email must be a valid email"],
    "age": ["age is required"]
  }
}`}
          </CodeBlock>

          <CodeBlock title="Reading the result">
{`result.fails()        // true if any field failed
result.passes()       // the inverse
result.errors         // { field: [message] }
result.first('email') // first message for a field, or null
result.all()          // [{ field, message }, ...]`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Available Rules</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Note that <code>min</code> and <code>max</code> cover both cases: they compare
            length for strings and value for numbers.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { rule: 'required', desc: 'Must be present and not empty' },
              { rule: 'optional', desc: 'Skips the remaining rules when empty' },
              { rule: 'string', desc: 'Must be a string' },
              { rule: 'numeric', desc: 'Must be a number or numeric string' },
              { rule: 'integer', desc: 'Must be a whole number' },
              { rule: 'boolean', desc: 'Must be true or false' },
              { rule: 'array', desc: 'Must be an array' },
              { rule: 'email', desc: 'Must be a valid email address' },
              { rule: 'url', desc: 'Must be a valid URL' },
              { rule: 'min(n)', desc: 'String at least n characters, or number at least n' },
              { rule: 'max(n)', desc: 'String at most n characters, or number at most n' },
              { rule: 'between(a, b)', desc: 'Number within a and b, inclusive' },
              { rule: 'length(n)', desc: 'String exactly n characters' },
              { rule: 'in(...values)', desc: 'Must be one of the given values' },
              { rule: 'notIn(...values)', desc: 'Must not be one of the given values' },
              { rule: 'regex(pattern)', desc: 'Must match the pattern' },
              { rule: 'alpha', desc: 'Letters only' },
              { rule: 'alphanumeric', desc: 'Letters and numbers only' },
              { rule: 'date', desc: 'Must be a parseable date' },
              { rule: 'before(date)', desc: 'Date earlier than the given date' },
              { rule: 'after(date)', desc: 'Date later than the given date' },
              { rule: 'confirmed(field)', desc: 'Must match another field, e.g. password' },
              { rule: 'different(field)', desc: 'Must differ from another field' },
              { rule: 'unique(table, col?, exceptId?)', desc: 'No such row in the database' },
              { rule: 'exists(table, col?)', desc: 'A matching row exists in the database' },
            ].map(({ rule, desc }) => (
              <div key={rule} className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
                <code className="text-sm font-semibold">{rule}</code>
                <p className={`text-xs mt-1 ${t.muted}`}>{desc}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Optional Fields</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Rules ignore empty values, so a field without <code>required</code> is already
            optional — the other rules only apply once it has a value. Add <code>rules.optional</code>
            first when you want to stop the chain outright for an empty field.
          </p>

          <CodeBlock title="Optional fields">
{`const result = await validate(req.body, {
  name: [rules.required],       // must be present
  bio: [rules.max(500)],        // optional; if present, at most 500 characters
  website: [rules.url],         // optional; if present, must be a URL
  nickname: [rules.optional, rules.min(2)]
})`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Database Rules</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>unique</code> and <code>exists</code> query the database, so they are async —
            remember to <code>await validate(...)</code>.
          </p>

          <CodeBlock title="Unique">
{`// No other user has this email
email: [rules.required, rules.email, rules.unique('users')]

// Check a specific column
slug: [rules.unique('categories', 'slug')]

// Ignore the record being updated
email: [rules.unique('users', 'email', currentUserId)]`}
          </CodeBlock>

          <CodeBlock title="Exists">
{`// The referenced user must exist
user_id: [rules.required, rules.exists('users')]

// Match on a specific column
category: [rules.exists('categories', 'slug')]`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Custom Rules</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A rule is a function receiving <code>(value, field, data)</code>. Return a message
            to fail, or <code>null</code> to pass. Rules may be async.
          </p>

          <CodeBlock title="A custom rule">
{`const isSlug = (value, field) => {
  if (!/^[a-z0-9-]+$/.test(value)) {
    return \`\${field} must contain only lowercase letters, numbers and hyphens\`
  }
  return null
}

const result = await validate(req.body, {
  slug: [rules.required, isSlug]
})`}
          </CodeBlock>

          <CodeBlock title="An async rule">
{`const isAvailableUsername = async (value) => {
  const existing = await (await db.table('users'))
    .where('username', value)
    .first()

  return existing ? 'Username is already taken' : null
}

const result = await validate(req.body, {
  username: [rules.required, isAvailableUsername]
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The third argument is the whole payload, which is how a rule can compare fields.
          </p>

          <CodeBlock title="Using the full payload">
{`const afterStart = (value, field, data) => {
  if (new Date(value) <= new Date(data.starts_at)) {
    return \`\${field} must be after starts_at\`
  }
  return null
}`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Custom Error Messages</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Wrap a check with the <code>rule</code> helper to supply your own message. The
            validator it wraps signals failure by returning <code>false</code>.
          </p>

          <CodeBlock title="rule(validator, message)">
{`import { validate, rules, rule } from '@basicbenframework/core/validation'

const result = await validate(req.body, {
  email: [
    rule((value) => !!value, 'Please enter your email'),
    rule((value) => /.+@.+\\..+/.test(value), 'Please enter a valid email address')
  ],
  password: [
    rule((value) => (value || '').length >= 8, 'Password must be at least 8 characters')
  ]
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The message may also be a function of <code>(field, value)</code>, which is useful
            when it should mention what was submitted.
          </p>

          <CodeBlock title="A message built from the value">
{`rule(
  (value) => (value || '').length <= 100,
  (field, value) => \`\${field} is \${value.length} characters; the limit is 100\`
)`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Nested Data</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Schema keys are looked up directly on the object, so dot notation like
            <code>'user.name'</code> does not resolve into a nested object. Validate the
            nested object on its own, or pull the values up first.
          </p>

          <CodeBlock title="Validate the nested object separately">
{`// Request body: { user: { name: 'Ada', email: 'ada@example.com' } }

const result = await validate(req.body.user ?? {}, {
  name: [rules.required, rules.min(2)],
  email: [rules.required, rules.email]
})`}
          </CodeBlock>

          <CodeBlock title="Or flatten first">
{`const result = await validate(
  { name: req.body.user?.name, email: req.body.user?.email },
  {
    name: [rules.required, rules.min(2)],
    email: [rules.required, rules.email]
  }
)`}
          </CodeBlock>
        </Card>
      </div>
    </div>
  )
}
