# Testing BasicBen

## Quick Start

```bash
# Run all tests
npm test

# Run tests for a specific module
npm run test:db
npm run test:validation
npm run test:auth
npm run test:server
npm run test:cli
npm run test:scaffolding

# Run integration tests (creates test app)
npm run test:app        # JavaScript template
npm run test:app:ts     # TypeScript template
```

---

## Test Modules

### Database (`src/db/`)

```bash
npm run test:db
```

Tests for:
- SQLite adapter
- PostgreSQL adapter (pool options only; no server in CI)
- Turso adapter, against a local server that speaks Hrana 3
- QueryBuilder (fluent API)
- Grammar (SQL escaping/validation)
- Seeder

### Validation (`src/validation/`)

```bash
npm run test:validation
```

Tests for:
- Core `validate()` function
- Built-in rules (required, email, min, max, etc.)
- Custom rules
- Database rules (unique, exists)

### Auth (`src/auth/`)

```bash
npm run test:auth
```

Tests for:
- JWT signing and verification
- Password hashing

### Server (`src/server/`)

```bash
npm run test:server
```

Tests for:
- Router
- File-based routing

### CLI (`src/cli/`)

```bash
npm run test:cli
```

Tests for:
- Argument parser

### Scaffolding (`src/scaffolding/`)

```bash
npm run test:scaffolding
```

Tests for:
- File generation from stubs
- Name transformations

### Integration Tests (`scripts/test-app.sh`)

```bash
npm run test:app      # JavaScript template
npm run test:app:ts   # TypeScript template
```

Full end-to-end tests that:
1. Create a test app from template
2. Run migrations
3. Start dev server
4. Test all API endpoints
5. Build for production
6. Test production server

**API Endpoints Tested:**

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/register` | User registration |
| `POST /api/auth/login` | User login |
| `GET /api/feed` | Public feed |
| `GET/POST /api/posts` | Posts CRUD |
| `GET/POST /api/categories` | Categories CRUD |
| `GET/POST /api/tags` | Tags CRUD |
| `GET/POST /api/pages` | Pages CRUD |
| `GET/POST /api/posts/:id/comments` | Comments |
| `GET /api/media` | Media library |
| `GET /api/settings` | Site settings |
| `GET /api/themes` | Theme management |
| `GET /api/themes/active` | Active theme |
| `GET /api/plugins` | Plugin management |
| `GET /api/updates/check` | Check for updates |
| `GET /api/registry/plugins` | Browse plugin registry |
| `GET /api/registry/themes` | Browse theme registry |
| `GET /api/backups` | List backups |
| `GET /feed.xml` | RSS feed |
| `GET /feed.json` | JSON feed |
| `GET /sitemap.xml` | Sitemap |

---

## Running Tests

### All tests

```bash
npm test
```

### With verbose output

```bash
node --test --test-reporter spec src/**/*.test.js
```

### Specific test file

```bash
node --test src/db/QueryBuilder.test.js
```

### With coverage

```bash
node --test --experimental-test-coverage src/**/*.test.js
```

---

## Testing with my-test-app

Create a local test app to test the full framework integration, including the blogging platform features.

### Quick setup (recommended)

```bash
# JavaScript template
npm run test:app

# TypeScript template
npm run test:app:ts
```

Then start the dev server:

```bash
cd my-test-app
npm run dev
```

### Features to test manually

- **Admin Dashboard**: Navigate to `/admin`
- **Posts**: Create, edit, delete posts at `/admin/posts`
- **Pages**: Static pages at `/admin/pages`
- **Categories & Tags**: Organize content at `/admin/categories` and `/admin/tags`
- **Comments**: Moderate comments at `/admin/comments`
- **Media Library**: Upload files at `/admin/media`
- **Themes**: Switch themes at `/admin/themes`
- **Plugins**: Enable/disable plugins at `/admin/plugins`
- **Updates**: Check for updates at `/admin/updates`
- **Settings**: Site configuration at `/admin/settings`
- **Feeds**: Check `/feed.xml`, `/feed.json`, `/sitemap.xml`

### Manual setup

```bash
# Create test app with local framework link (JavaScript)
node create-basicben-app/index.js my-test-app --local

# Create test app with local framework link (TypeScript)
node create-basicben-app/index.js my-test-app --local --typescript

cd my-test-app
npm install
npm run migrate
npm run seed        # Populate with sample data
npm run dev
```

### Test credentials

After seeding:
- Email: `admin@example.com` or `test@example.com`
- Password: `password123`

### Configure ports (optional)

Edit `my-test-app/.env`:

```env
PORT=3001              # API server
VITE_PORT=3002         # Frontend dev server
```

### Clean up

```bash
rm -rf my-test-app
```

The `my-test-app/` directory is gitignored.

---

## Database Adapter Tests

Adapter tests are skipped unless the database is configured:

| Adapter | Environment Variables |
|---------|----------------------|
| SQLite | None — uses a temp file |
| Turso | None — the suite starts its own Hrana server |
| PostgreSQL | `DATABASE_URL`, for the tests that need a live server |

The Turso suite does not need a Turso account. It runs a local HTTP server
speaking Hrana 3 backed by `node:sqlite`, so the wire format — integers and
rowids as strings, blobs as base64, batons threading a transaction — is
exercised for real rather than mocked.

To additionally run against a genuine Turso database, set both variables and the
live suite stops skipping:

```bash
export TURSO_URL=libsql://your-db.turso.io
export TURSO_AUTH_TOKEN=your-token

npm run test:db
```

---

## Writing Tests

Tests use Node's built-in test runner:

```javascript
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'

describe('MyModule', () => {
  test('does something', async () => {
    const result = await myFunction()
    assert.strictEqual(result, expected)
  })
})
```

### Test file naming

- Place tests next to source files: `module.js` → `module.test.js`
- Or in a `__tests__/` directory

### Async tests

```javascript
test('async operation', async () => {
  const result = await asyncFunction()
  assert.ok(result)
})
```

### Skipping tests

```javascript
describe('Feature', { skip: !featureAvailable }, () => {
  // Tests only run if featureAvailable is true
})
```
