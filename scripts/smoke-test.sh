#!/bin/bash
#
# End-to-end smoke test.
#
# Packs both published artifacts, scaffolds an app from them exactly as a user
# would, builds it, boots the production server, and checks that it actually
# serves. Unit tests pass on all of the failures this catches:
#
#   - a create tarball published without its templates (0.1.12)
#   - a generated server entry that cannot start (0.1.10)
#   - client routes returning a JSON 404 in production
#
# Usage: ./scripts/smoke-test.sh
#
# TypeScript is the only template, so there is nothing to select. `--ts` is
# still accepted and ignored, so older invocations keep working.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORK_DIR="$(mktemp -d)"
PORT="${SMOKE_PORT:-3987}"
SERVER_PID=""
APP_NAME="smoke-app"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo ""
echo "Smoke test ($APP_NAME) in $WORK_DIR"
echo ""

# --- Pack both artifacts -----------------------------------------------------

cd "$ROOT_DIR"
CORE_TGZ="$(npm pack --pack-destination "$WORK_DIR" 2>/dev/null | tail -1)"
cd "$ROOT_DIR/create-basicben-app"
CREATE_TGZ="$(npm pack --pack-destination "$WORK_DIR" 2>/dev/null | tail -1)"

# The create package must ship its templates. Publishing without them produced a
# CLI that created an empty directory and reported success.
TEMPLATE_COUNT="$(tar -tzf "$WORK_DIR/$CREATE_TGZ" | grep -c 'package/template-' || true)"
if [ "$TEMPLATE_COUNT" -lt 50 ]; then
  fail "create tarball contains only $TEMPLATE_COUNT template files — templates missing"
fi
pass "create tarball ships templates ($TEMPLATE_COUNT files)"

# --- Scaffold ----------------------------------------------------------------

cd "$WORK_DIR"
tar -xzf "$CREATE_TGZ"
node package/index.js "$APP_NAME" > /dev/null

# Hook listeners, appended to the app's own hooks file before the build. This
# is how an app extends the framework now that plugins are gone, so it is what
# the checks below should exercise — through the same file a user would edit.
cat >> "$APP_NAME/src/hooks.ts" <<'PROBE'

// --- smoke test probes -------------------------------------------------------

hooks.on(HOOKS.POST_CREATING, async (data: { title?: string }) => ({
  ...data,
  title: `[hooked] ${data.title}`
}))

hooks.on(HOOKS.CONTENT_SAVE, async (html: string) => `${html}<p data-probe="1"></p>`)

hooks.on(HOOKS.ADMIN_MENU, async (items: Array<{ path: string; label: string }>) => [
  ...items,
  { path: '/admin/probe', label: 'Probe' }
])

hooks.on(HOOKS.SERVER_STARTED, async () => {
  console.log('PROBE:server.started')
})

// One listener that throws, to prove it cannot take the others down with it.
// The name is what makes the logged error point at the culprit.
hooks.on(HOOKS.POST_CREATED, async () => {
  throw new Error('deliberate')
}, { name: 'broken' })
PROBE

FILE_COUNT="$(find "$APP_NAME" -type f | wc -l | tr -d ' ')"
if [ "$FILE_COUNT" -lt 20 ]; then
  fail "scaffolded app has only $FILE_COUNT files"
fi
pass "scaffolded $FILE_COUNT files"

# --- Install and build -------------------------------------------------------

cd "$WORK_DIR/$APP_NAME"
npm install --silent --no-audit --no-fund > /dev/null 2>&1
npm install --silent --no-audit --no-fund "$WORK_DIR/$CORE_TGZ" > /dev/null 2>&1
pass "installed dependencies"

# --- Typecheck ---------------------------------------------------------------
#
# The TypeScript template's whole point is type safety, and unit tests say
# nothing about it. Shipping @basicbenframework/core without declarations made
# every framework import an implicit any, which typechecks silently: 64 TS7016
# errors that no other check in this repo could see.

# The package must actually carry its declarations, whatever the export map
# claims. A tarball built without them still installs and still builds.
DTS_COUNT="$(tar -tzf "$WORK_DIR/$CORE_TGZ" | grep -c 'package/types/.*\.d\.ts$' || true)"
if [ "$DTS_COUNT" -lt 50 ]; then
  fail "core tarball ships only $DTS_COUNT declaration files — types/ is missing or stale"
fi
pass "core tarball ships declarations ($DTS_COUNT files)"

if ! npx tsc --noEmit > "$WORK_DIR/tsc.log" 2>&1; then
  echo "--- tsc --noEmit ---"
  head -40 "$WORK_DIR/tsc.log"
  fail "the scaffolded TypeScript app does not typecheck"
fi
pass "scaffolded app typechecks with no errors"

# The generators emit TypeScript, so what they write has to typecheck inside a
# real app — not just resolve its imports. A stub referring to a type that does
# not exist, or leaving a parameter implicitly any under `strict`, produces a
# file that the app it was generated into cannot compile.
npx basicben make:controller widget > /dev/null 2>&1 || fail "make:controller failed"
npx basicben make:model widget > /dev/null 2>&1 || fail "make:model failed"
npx basicben make:route widget > /dev/null 2>&1 || fail "make:route failed"
npx basicben make:middleware logger > /dev/null 2>&1 || fail "make:middleware failed"
npx basicben make:migration create_widgets > /dev/null 2>&1 || fail "make:migration failed"
npx basicben make:seed widgets > /dev/null 2>&1 || fail "make:seed failed"

for expected in src/controllers/WidgetController.ts src/models/Widget.ts \
                src/routes/api/widget.ts src/middleware/logger.ts db/seeds/widgets.ts; do
  [ -f "$expected" ] || fail "generators did not write $expected"
done
ls db/migrations/*_create_widgets.ts > /dev/null 2>&1 \
  || fail "make:migration did not write a .ts migration"
pass "generators emit TypeScript"

if ! npx tsc --noEmit > "$WORK_DIR/tsc-generated.log" 2>&1; then
  echo "--- tsc --noEmit after generating ---"
  head -40 "$WORK_DIR/tsc-generated.log"
  fail "generated files do not typecheck"
fi
pass "generated files typecheck"

# And the generated migration must actually be found — the migrator, the seeder
# and the route loader all filtered for .js, so TypeScript output would have been
# discovered by nothing and silently never run.
npx basicben migrate > "$WORK_DIR/migrate-ts.log" 2>&1 || fail "migrating the generated .ts migration failed"
grep -qi "create_widgets" "$WORK_DIR/migrate-ts.log" \
  || { cat "$WORK_DIR/migrate-ts.log"; fail "the generated .ts migration was not discovered"; }
pass "a generated .ts migration runs"

# The committed declarations are generated from the JSDoc, so an edit to a
# signature that skips `npm run build:types` ships types that describe the
# previous version. Only checkable where the framework's own tsc is
# installed, which is the machine where that edit is being made.
if [ -x "$ROOT_DIR/node_modules/.bin/tsc" ]; then
  "$ROOT_DIR/node_modules/.bin/tsc" -p "$ROOT_DIR/tsconfig.types.json" \
    --outDir "$WORK_DIR/types-fresh" > /dev/null 2>&1
  if ! diff -rq "$ROOT_DIR/types" "$WORK_DIR/types-fresh" > "$WORK_DIR/types.diff" 2>&1; then
    echo "--- stale declarations ---"
    head -20 "$WORK_DIR/types.diff"
    fail "types/ is out of date — run 'npm run build:types' and commit the result"
  fi
  pass "committed declarations match the JSDoc"
fi

# The docs page renders a generated module rather than a hand-written table, so
# an edit to PublicContent.ts that skips the generator ships a reference
# describing the previous shape. Same failure as stale declarations, same check.
if ! node "$ROOT_DIR/scripts/generate-api-reference.js" --check > "$WORK_DIR/reference.log" 2>&1; then
  cat "$WORK_DIR/reference.log"
  fail "api-reference.ts is stale — run 'node scripts/generate-api-reference.js' and commit it"
fi
pass "the API reference matches the interfaces it documents"

if [ -x "$ROOT_DIR/node_modules/.bin/tsc" ]; then

  # Apps compile with skipLibCheck, so a declaration can be malformed and
  # still let every app typecheck. JSDoc that emits an optional parameter
  # before a required one produced exactly that: an invalid .d.ts nobody saw.
  if ! (cd "$ROOT_DIR" && ./node_modules/.bin/tsc --noEmit --skipLibCheck false \
         --strict false --moduleResolution bundler --module esnext \
         --target es2022 --lib es2022,dom,dom.iterable \
         $(find types -name '*.d.ts')) > "$WORK_DIR/dts.log" 2>&1; then
    echo "--- declarations do not check on their own ---"
    head -20 "$WORK_DIR/dts.log"
    fail "generated declarations are not self-consistent"
  fi
  pass "declarations check on their own, without skipLibCheck"
fi

npx basicben build > /dev/null 2>&1 || fail "build failed"
[ -f dist/client/index.html ] || fail "dist/client/index.html missing after build"
[ -f dist/server/index.js ] || fail "dist/server/index.js missing after build"
pass "built client and server"

# The app under test is a production build serving its own uploads on $PORT, so
# that is the origin the content API must resolve media URLs against. A
# scaffolded project gets APP_URL pointing at the dev server instead; overriding
# it here is what makes "fetch the URL that was handed out" a real check rather
# than a request to whatever happens to be on port 3000.
printf '\nAPP_URL=http://localhost:%s\n' "$PORT" >> .env

# --- Database ----------------------------------------------------------------
#
# SQLite unless told otherwise. Point SMOKE_DATABASE_URL at a Postgres database
# and the whole suite below runs against it:
#
#   SMOKE_DATABASE_URL=postgres://user@localhost:5432/smoke ./scripts/smoke-test.sh
#
# That is how dialect portability gets verified rather than assumed. It was
# assumed for a long time, and the app was unusable on Postgres the entire time:
# the migrations were SQLite-only, the rate limiter's hand-written SQL used `?`
# placeholders, its timestamp columns overflowed a 32-bit integer, and the
# models' raw INSERTs returned no id.
#
# The connection string goes into .env because that is what both the CLI and
# `node --env-file=.env dist/server/index.js` read — one place covers migrating
# and serving.
if [ -n "${SMOKE_DATABASE_URL:-}" ]; then
  printf '\nDATABASE_URL=%s\n' "$SMOKE_DATABASE_URL" >> .env

  # Repeatable against a database that already has tables from a previous run.
  npx basicben migrate:fresh > "$WORK_DIR/migrate.log" 2>&1 \
    || { cat "$WORK_DIR/migrate.log"; fail "migrations failed against SMOKE_DATABASE_URL"; }
  pass "ran migrations against $(printf '%s' "$SMOKE_DATABASE_URL" | sed 's|://[^@/]*@|://…@|')"
else
  npx basicben migrate > /dev/null 2>&1 || fail "migrations failed"
  pass "ran migrations"
fi

# --- Transactional migrations --------------------------------------------------
#
# A migration that throws halfway used to leave whatever it had already done
# behind, with nothing recorded as having run — so the next `migrate` died on
# "table already exists" and there was nothing to roll back. That was hit for
# real while making Postgres work.
#
# The probe is indirect on purpose: rather than asking the database whether
# `tx_probe` exists, which needs a query tool per driver, a second migration
# creates the same table. If the failed one left residue, that one cannot run.
# The check therefore works identically on SQLite and Postgres.

cat > db/migrations/9999_01_01_000000_tx_probe_fails.js <<'PROBE'
export const up = async (db) => {
  await db.exec('CREATE TABLE tx_probe (id INTEGER)')
  throw new Error('deliberate failure, after creating a table')
}
export const down = async () => {}
PROBE

if npx basicben migrate > "$WORK_DIR/tx-probe.log" 2>&1; then
  fail "a migration that throws should have failed the command"
fi
pass "a failing migration fails the command"

rm db/migrations/9999_01_01_000000_tx_probe_fails.js

cat > db/migrations/9999_01_02_000000_tx_probe_works.js <<'PROBE'
export const up = async (db) => {
  await db.exec('CREATE TABLE tx_probe (id INTEGER)')
}
export const down = async (db) => {
  await db.exec('DROP TABLE tx_probe')
}
PROBE

npx basicben migrate > "$WORK_DIR/tx-probe2.log" 2>&1 \
  || { cat "$WORK_DIR/tx-probe2.log"; fail "the failed migration left its table behind — it was not rolled back"; }
pass "a failed migration leaves no half-applied schema"

# And rolling that batch back leaves the database as it was, which is the other
# half of the same guarantee.
npx basicben migrate:rollback > "$WORK_DIR/tx-rollback.log" 2>&1 \
  || { cat "$WORK_DIR/tx-rollback.log"; fail "rolling back the probe failed"; }
rm db/migrations/9999_01_02_000000_tx_probe_works.js
pass "and the batch rolls back cleanly"

# --- Boot --------------------------------------------------------------------

# --env-file matches how `basicben start` runs this, so APP_KEY is available
NODE_ENV=production PORT="$PORT" node --env-file=.env dist/server/index.js \
  > "$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "--- server log ---"; cat "$WORK_DIR/server.log"
    fail "server exited during startup"
  fi
  sleep 1
done
pass "server booted"

grep -q "PROBE:server.started" "$WORK_DIR/server.log" \
  || fail "server.started never fired — it only fires from app.start(), which nothing calls"
pass "server.started fires"

status() { curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$1"; }

# --- Assertions --------------------------------------------------------------

[ "$(status /)" = "200" ] || fail "GET / returned $(status /), expected 200"
pass "GET / serves the app"

for route in /feed /posts /login; do
  code="$(status $route)"
  [ "$code" = "200" ] || fail "GET $route returned $code — SPA history fallback is not working"
done
pass "client routes survive a direct request"

API_BODY="$(curl -s "http://localhost:$PORT/api/does-not-exist")"
case "$API_BODY" in
  *'"error"'*) pass "unknown API paths still return JSON" ;;
  *) fail "unknown API path returned non-JSON — the SPA fallback is shadowing the API" ;;
esac

ASSET_CODE="$(status /assets/definitely-missing.js)"
[ "$ASSET_CODE" = "404" ] || fail "missing asset returned $ASSET_CODE, expected 404"
pass "missing assets still 404"

# --- Privilege separation ----------------------------------------------------
#
# Only the TypeScript template ships the admin API. Before roles existed, any
# authenticated user could reach all of it.

register() {
  curl -s -X POST "http://localhost:$PORT/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"password123\"}"
}

token_of() { echo "$1" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }
role_of()  { echo "$1" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p'; }

OWNER_JSON="$(register Owner owner@example.com)"
OWNER_TOKEN="$(token_of "$OWNER_JSON")"
[ -n "$OWNER_TOKEN" ] || { echo "$OWNER_JSON"; fail "could not register the first user"; }
[ "$(role_of "$OWNER_JSON")" = "admin" ] || fail "first user should be admin, got '$(role_of "$OWNER_JSON")'"
pass "first registered user becomes admin"

VISITOR_JSON="$(register Visitor visitor@example.com)"
VISITOR_TOKEN="$(token_of "$VISITOR_JSON")"
[ "$(role_of "$VISITOR_JSON")" = "subscriber" ] || fail "second user should be subscriber, got '$(role_of "$VISITOR_JSON")'"
pass "later users default to subscriber"

# The admin API only exists in the TypeScript template.
auth_status() {
  curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $1" "http://localhost:$PORT$2"
}

for path in /api/settings /api/comments/pending; do
  code="$(auth_status "$VISITOR_TOKEN" "$path")"
  [ "$code" = "403" ] || fail "subscriber got $code on $path, expected 403"
done
pass "subscribers are refused the admin API"

code="$(auth_status "$OWNER_TOKEN" /api/settings)"
[ "$code" = "200" ] || fail "admin got $code on /api/settings, expected 200"
pass "admin still reaches the admin API"

# --- Email verification -------------------------------------------------------
#
# The console transport prints the message, including the link, to the server
# log — which is what makes an end-to-end check possible with no mail account.

case "$OWNER_JSON" in
  *'"email_verified":true'*) pass "the first account is trusted, so a fresh install is not locked out" ;;
  *) echo "$OWNER_JSON"; fail "the first account should be verified without an email" ;;
esac

VISITOR2_JSON="$(register Newcomer newcomer@example.com)"
VISITOR2_TOKEN="$(token_of "$VISITOR2_JSON")"

case "$VISITOR2_JSON" in
  *'"email_verified":false'*) pass "a new account starts unverified" ;;
  *) echo "$VISITOR2_JSON"; fail "a new account should start unverified" ;;
esac

# Give the console transport a moment to flush to the log.
sleep 1
# The port is whatever APP_URL says, not a literal: this pattern was pinned to
# 3000 and broke the moment APP_URL stopped being the default.
VERIFY_URL="$(grep -oE 'https?://[^ ]*/verify/[A-Za-z0-9_-]+' "$WORK_DIR/server.log" | tail -1)"
[ -n "$VERIFY_URL" ] || { tail -20 "$WORK_DIR/server.log"; fail "no verification link was sent"; }
pass "registration sends a verification link"

VERIFY_TOKEN="${VERIFY_URL##*/}"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/auth/verify/$VERIFY_TOKEN")"
case "$code" in
  30*) pass "the link redirects back into the app" ;;
  *) fail "verify returned $code, expected a redirect" ;;
esac

STATUS="$(curl -s -H "Authorization: Bearer $VISITOR2_TOKEN" "http://localhost:$PORT/api/auth/verify")"
case "$STATUS" in
  *'"verified":true'*) pass "the address is verified afterwards" ;;
  *) echo "$STATUS"; fail "the address should be verified" ;;
esac

code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/auth/verify/$VERIFY_TOKEN")"
case "$code" in
  30*) pass "a spent link cannot be reused" ;;
  *) fail "reusing a link returned $code" ;;
esac

# --- Two-factor authentication ------------------------------------------------
#
# Only the TypeScript template ships the 2FA endpoints. The point of doing this
# end to end is that a correct password must stop being enough.

tfa() {
  curl -s -X "$1" "http://localhost:$PORT$2" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $OWNER_TOKEN" \
    -d "${3:-\{\}}"
}

SETUP="$(tfa POST /api/auth/2fa/totp/setup '{"password":"password123"}')"
SECRET="$(echo "$SETUP" | sed -n 's/.*"secret":"\([^"]*\)".*/\1/p')"
[ -n "$SECRET" ] || { echo "$SETUP"; fail "could not start TOTP enrolment"; }
pass "TOTP setup returns a secret"

case "$SETUP" in
  *'otpauth://totp/'*) pass "and an otpauth URI for the authenticator" ;;
  *) fail "no otpauth URI in the setup response" ;;
esac

# Enrolment must not be active until a working code proves the app was set up.
LOGIN="$(curl -s -X POST "http://localhost:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"password123"}')"
case "$LOGIN" in
  *'"token"'*) pass "an unconfirmed secret does not lock the account" ;;
  *) echo "$LOGIN"; fail "login should still work before confirmation" ;;
esac

# Compute a live code the way an authenticator app would. The shell is
# already inside the scaffolded app, so the package subpath resolves.
totp_code() {
  node --input-type=module -e \
    "import { totp } from '@basicbenframework/core/auth/totp'; console.log(totp(process.argv[1]))" \
    "$1"
}

CODE="$(totp_code "$SECRET")"
[ -n "$CODE" ] || fail "could not compute a TOTP code"

CONFIRM="$(tfa POST /api/auth/2fa/totp/confirm "{\"code\":\"$CODE\"}")"
case "$CONFIRM" in
  *'"enabled":true'*) pass "a valid code enables the factor" ;;
  *) echo "$CONFIRM"; fail "confirmation failed" ;;
esac

RECOVERY="$(echo "$CONFIRM" | sed -n 's/.*"recoveryCodes":\["\([^"]*\)".*/\1/p')"
[ -n "$RECOVERY" ] || fail "no recovery codes were issued"
pass "recovery codes are issued once"

# The whole point: the password alone must no longer be a session.
LOGIN2="$(curl -s -X POST "http://localhost:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"password123"}')"
case "$LOGIN2" in
  *'"twoFactorRequired":true'*) pass "the password alone stops being enough" ;;
  *) echo "$LOGIN2"; fail "login should now require a second factor" ;;
esac
case "$LOGIN2" in
  *'"token"'*) fail "login must not return a session token alongside a challenge" ;;
  *) pass "and no session token is leaked with the challenge" ;;
esac

CHALLENGE="$(echo "$LOGIN2" | sed -n 's/.*"challenge":"\([^"]*\)".*/\1/p')"

BAD="$(curl -s -X POST "http://localhost:$PORT/api/auth/2fa/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"challenge\":\"$CHALLENGE\",\"code\":\"000000\"}")"
case "$BAD" in
  *'"error"'*) pass "a wrong code is refused" ;;
  *) fail "a wrong code should not succeed" ;;
esac

# A recovery code is a full second factor.
LOGIN3="$(curl -s -X POST "http://localhost:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"password123"}')"
CHALLENGE3="$(echo "$LOGIN3" | sed -n 's/.*"challenge":"\([^"]*\)".*/\1/p')"

RECOVERED="$(curl -s -X POST "http://localhost:$PORT/api/auth/2fa/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"challenge\":\"$CHALLENGE3\",\"code\":\"$RECOVERY\"}")"
case "$RECOVERED" in
  *'"recoveryCodeUsed":true'*) pass "a recovery code completes a sign-in" ;;
  *) echo "$RECOVERED"; fail "the recovery code should have worked" ;;
esac

# --- Passkeys -----------------------------------------------------------------
#
# A virtual authenticator drives the real HTTP endpoints, which is what proves
# the wiring — challenge storage, credential lookup, the login handoff — rather
# than just the ceremony logic the unit tests cover.

# A fresh account, so the TOTP factor enrolled above does not interfere.
PK_JSON="$(register Passkeyer passkey@example.com)"
PK_TOKEN="$(token_of "$PK_JSON")"
[ -n "$PK_TOKEN" ] || { echo "$PK_JSON"; fail "could not register the passkey user"; }

# The origin has to match what the server derives from APP_URL, or the
# assertion is rejected for the right reason and the test fails for the wrong
# one. Both sides used to fall back to the same hardcoded default and agreed by
# luck; now they are told.
if APP_URL="http://localhost:$PORT" node "$ROOT_DIR/scripts/passkey-smoke.mjs" \
     "http://localhost:$PORT" "$PK_TOKEN" passkey@example.com password123 2>&1 \
     | sed 's/^ok /'"$(printf '\033[0;32m')"'✓'"$(printf '\033[0m')"' /'; then
  pass "passkey enrolment and sign-in work end to end"
else
  fail "the passkey flow failed"
fi

# --- Rate limiting -------------------------------------------------------------
#
# Until this existed, password guessing on the login endpoint was unthrottled.
# A fresh address is used so the successful sign-ins above do not interfere —
# a correct password clears the counter, which is the intended behaviour.

guess() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"owner@example.com","password":"definitely-wrong"}'
}

LIMITED=""
for _ in $(seq 1 8); do
  code="$(guess)"
  if [ "$code" = "429" ]; then LIMITED="yes"; break; fi
done

[ -n "$LIMITED" ] || fail "password guessing was never throttled"
pass "repeated wrong passwords are throttled"

# The refusal has to tell the caller when to come back.
BODY="$(curl -s -X POST "http://localhost:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"definitely-wrong"}')"
case "$BODY" in
  *'"retryAfter"'*) pass "and the refusal says when to retry" ;;
  *) echo "$BODY"; fail "a 429 should carry retryAfter" ;;
esac

# Another account must still be able to sign in — the limit is per account,
# not a global switch that one attacker can flip for everyone.
OTHER="$(curl -s -X POST "http://localhost:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"visitor@example.com","password":"password123"}')"
case "$OTHER" in
  *'"token"'*) pass "one locked account does not lock out another" ;;
  *) echo "$OTHER"; fail "an unrelated account should still sign in" ;;
esac

# --- Markdown content ----------------------------------------------------------
#
# Before this existed the editor advertised Markdown and stored whatever was
# typed, which was then rendered with dangerouslySetInnerHTML — so the
# advertised feature did nothing and the unadvertised one was stored XSS.
#
# A fresh account is used because the checks above deliberately lock accounts
# out, and a throttled login here would look like a Markdown failure.

MD_EMAIL="author-$$@example.com"

curl -s -X POST "http://localhost:$PORT/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Author\",\"email\":\"$MD_EMAIL\",\"password\":\"password123\"}" > /dev/null

MD_TOKEN="$(curl -s -X POST "http://localhost:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$MD_EMAIL\",\"password\":\"password123\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"

[ -n "$MD_TOKEN" ] || fail "could not sign in to create a post"

# Markdown that also carries a script tag and a javascript: link. Both must
# survive as visible text; neither may become markup.
MD_BODY='{"title":"Markdown test","content":"# Heading\n\nSome **bold** text and a [link](https://example.com).\n\n- one\n- two\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))","published":true}'

CREATED="$(curl -s -X POST "http://localhost:$PORT/api/posts" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MD_TOKEN" \
  -d "$MD_BODY")"

POST_ID="$(printf '%s' "$CREATED" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)"
[ -n "$POST_ID" ] || { echo "$CREATED"; fail "could not create a post"; }

STORED="$(curl -s "http://localhost:$PORT/api/posts/$POST_ID" \
  -H "Authorization: Bearer $MD_TOKEN")"

# The filters must have altered what was actually written.
case "$CREATED" in
  *'[hooked] Markdown test'*) pass "post.creating filtered the write" ;;
  *) echo "$CREATED"; fail "post.creating did not alter the stored title" ;;
esac

case "$CREATED" in
  *'data-probe'*) pass "content.save filtered the stored HTML" ;;
  *) fail "content.save did not affect what was stored" ;;
esac

grep -qi 'Hook "post.created" (broken' "$WORK_DIR/server.log" \
  && pass "a failing hook is reported with the listener that caused it" \
  || fail "a failing hook was swallowed, or does not name the listener"

# The admin API only exists in the TypeScript template.
MENU="$(curl -s "http://localhost:$PORT/api/admin/menu" -H "Authorization: Bearer $OWNER_TOKEN")"
case "$MENU" in
  *'/admin/probe'*) pass "a hook can extend the admin menu" ;;
  *) echo "$MENU"; fail "admin.menu did not reach the UI" ;;
esac
case "$MENU" in
  *'/admin/posts'*) pass "and the built-in menu items survive" ;;
  *) fail "the listener replaced the menu instead of extending it" ;;
esac

case "$STORED" in
  *'<h1'*) pass "markdown is rendered on save" ;;
  *) echo "$STORED"; fail "a heading should have become <h1>" ;;
esac

case "$STORED" in
  *'<strong>bold</strong>'*) pass "inline marks render" ;;
  *) fail "**bold** should have become <strong>" ;;
esac

case "$STORED" in
  *'<li>one</li>'*) pass "lists render" ;;
  *) fail "a bulleted list should have become <li> items" ;;
esac

case "$STORED" in
  *'href=\"https://example.com\"'*) pass "links render" ;;
  *) fail "a markdown link should have become an anchor" ;;
esac

# The security claim, checked against what is actually stored.
case "$STORED" in
  *'"content_html"'*'<script>'*) echo "$STORED"; fail "a script tag survived into stored HTML" ;;
  *) pass "a script tag is escaped, not executed" ;;
esac

case "$STORED" in
  *'href=\"javascript:'*) echo "$STORED"; fail "a javascript: URL survived into stored HTML" ;;
  *) pass "a javascript: link does not become an anchor" ;;
esac

# The Markdown source is kept intact — it is the canonical copy, and losing it
# would make the HTML impossible to regenerate.
case "$STORED" in
  *'# Heading'*) pass "the markdown source is preserved alongside the html" ;;
  *) fail "the original markdown should still be stored in content" ;;
esac

# Editing must re-render, or the two columns silently drift apart.
curl -s -X PUT "http://localhost:$PORT/api/posts/$POST_ID" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MD_TOKEN" \
  -d '{"title":"Markdown test","content":"## Edited heading","published":true}' > /dev/null

EDITED="$(curl -s "http://localhost:$PORT/api/posts/$POST_ID" \
  -H "Authorization: Bearer $MD_TOKEN")"

case "$EDITED" in
  *'<h2'*) pass "editing re-renders the html" ;;
  *) echo "$EDITED"; fail "an edit should have re-rendered content_html" ;;
esac

# The backfill command exists because stored HTML goes stale when the parser or
# the allowlist changes.
RERENDER="$(cd "$WORK_DIR/$APP_NAME" && npx basicben content:rerender 2>&1)" || {
  echo "$RERENDER"
  fail "content:rerender exited non-zero"
}

case "$RERENDER" in
  *'posts'*) pass "content:rerender runs over stored content" ;;
  *) echo "$RERENDER"; fail "content:rerender should have reported the posts table" ;;
esac

# --- Media uploads -------------------------------------------------------------
#
# The previous upload path could not work: the global body parser drained every
# non-GET request before the controller ran, so the multipart parser attached
# its listeners to an already-ended stream. Uploads now go straight from the
# browser to storage, and this drives that flow against the booted app.
#
# It also drives `/api/v1/media/:id`, which is why it runs here rather than at
# the end: the headless section below floods the content API until it 429s, and
# that limit is keyed on the address, so anything touching /api/v1 afterwards
# would be refused for the rest of the minute.

# The owner's token: uploading needs the media.upload capability, which a
# subscriber does not have. It was minted at registration, so the login
# lockout above does not affect it — a lockout stops new sign-ins, not tokens
# already issued.
node "$ROOT_DIR/scripts/storage-smoke.mjs" "http://localhost:$PORT" "$OWNER_TOKEN" \
  || fail "storage smoke test failed"

# --- Headless API --------------------------------------------------------------
#
# The point of this surface is that a program somewhere else can read the site's
# content with a credential that is not somebody's login. Everything here is
# checked against the running server rather than the module, because the parts
# that break are the seams: which middleware runs, what a scope refuses, and
# whether a second request actually gets a 304.

code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/v1/posts")"
[ "$code" = "401" ] || fail "anonymous /api/v1/posts got $code, expected 401"
pass "the content API refuses anonymous reads by default"

ISSUED="$(curl -s -X POST "http://localhost:$PORT/api/tokens" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"smoke","scopes":["content:read"]}')"

API_TOKEN="$(printf '%s' "$ISSUED" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token || ''" 2>/dev/null)"

case "$API_TOKEN" in
  bb_*) pass "an API token is issued with a bb_ prefix" ;;
  *) echo "$ISSUED"; fail "no API token came back" ;;
esac

# The plaintext exists only in that response. If it were recoverable the
# hash-only storage would be decorative.
LISTED="$(curl -s "http://localhost:$PORT/api/tokens" -H "Authorization: Bearer $OWNER_TOKEN")"
case "$LISTED" in
  *"$API_TOKEN"*) fail "the token plaintext is readable from the listing" ;;
  *) pass "the plaintext is never returned again" ;;
esac

token_status() {
  curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $API_TOKEN" "http://localhost:$PORT$1"
}

[ "$(token_status /api/v1/posts)" = "200" ] || fail "a content:read token was refused /api/v1/posts"
pass "a scoped token reads the content API"

# content:read must not reach media. A scope that grants everything is not a
# scope, and this is the assertion that would catch it becoming one.
[ "$(token_status /api/v1/media/1)" = "401" ] \
  || fail "a content:read token reached /api/v1/media, which needs media:read"
pass "a token is refused outside its scopes"

# Minting tokens from a token would make scopes meaningless: a leaked read-only
# credential could issue itself a write-scoped one.
[ "$(token_status /api/tokens)" = "403" ] \
  || fail "an API token was allowed to manage tokens"
pass "an API token cannot mint another"

V1_BODY="$(curl -s "http://localhost:$PORT/api/v1/posts" -H "Authorization: Bearer $API_TOKEN")"
case "$V1_BODY" in
  *'"author"'*) pass "the content API returns author names" ;;
  *) echo "$V1_BODY"; fail "no author field in the v1 response" ;;
esac

# The admin API joins users; the public one must not carry an address through.
case "$V1_BODY" in
  *'owner@example.com'*) fail "an author email leaked into the public API" ;;
  *) pass "no author email reaches the public API" ;;
esac

V1_ETAG="$(curl -s -D - -o /dev/null "http://localhost:$PORT/api/v1/posts" \
  -H "Authorization: Bearer $API_TOKEN" | grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2)"

[ -n "$V1_ETAG" ] || fail "the content API sent no ETag"

REVALIDATED="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/v1/posts" \
  -H "Authorization: Bearer $API_TOKEN" -H "If-None-Match: $V1_ETAG")"

[ "$REVALIDATED" = "304" ] || fail "revalidating with the ETag got $REVALIDATED, expected 304"
pass "the content API answers a conditional request with 304"

# What the docs promise is what the server sends.
#
# The reference is generated from the interfaces, so it cannot drift from the
# types — but an interface can promise a field the shaping code never sets, and
# the cast in between hides it. This compares the documented field list to the
# keys of a real response. It runs before the flood below, which exhausts the
# limiter for this address.
node "$ROOT_DIR/scripts/api-reference-smoke.mjs" "http://localhost:$PORT" "$OWNER_TOKEN" \
  || fail "the API reference does not match what the API returns"

# The public API is the one surface that can be served to anyone, and it had no
# limit at all. The limiter keys on the address and runs ahead of the scope
# check, so a flood of fabricated tokens is limited too rather than costing an
# indexed lookup each.
LIMITED=""
for _ in $(seq 1 140); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/v1/posts" \
    -H "Authorization: Bearer $API_TOKEN")"
  if [ "$code" = "429" ]; then LIMITED="yes"; break; fi
done

[ -n "$LIMITED" ] || fail "the content API never returned 429 across 140 requests"
pass "the content API rate limits a flood"

# A 429 a client cannot act on is only half a limit.
LIMIT_HEADERS="$(curl -s -D - -o /dev/null "http://localhost:$PORT/api/v1/posts" \
  -H "Authorization: Bearer $API_TOKEN" | tr -d '\r')"
case "$LIMIT_HEADERS" in
  *Retry-After*) pass "and says when to retry" ;;
  *) echo "$LIMIT_HEADERS"; fail "a limited response carried no Retry-After" ;;
esac

# --- Webhooks -----------------------------------------------------------------
#
# The delivery path only exists end to end: a hook fires in the server process,
# reads a setting from the database, signs a body and puts it on the wire. The
# unit tests cover the signing; only this covers the wiring.

WEBHOOK_PORT="$(( PORT + 1 ))"
WEBHOOK_LOG="$WORK_DIR/webhook.log"

cat > "$WORK_DIR/receiver.mjs" <<'RECEIVER'
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    appendFileSync(process.argv[2], JSON.stringify({
      event: req.headers['x-basicben-event'],
      signature: req.headers['x-basicben-signature'],
      body
    }) + '\n')
    res.statusCode = 200
    res.end('ok')
  })
}).listen(Number(process.argv[3]))
RECEIVER

node "$WORK_DIR/receiver.mjs" "$WEBHOOK_LOG" "$WEBHOOK_PORT" &
RECEIVER_PID=$!
sleep 1

curl -s -X PUT "http://localhost:$PORT/api/settings" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"settings\":{\"webhook_urls\":\"http://localhost:$WEBHOOK_PORT/hook\"}}" -o /dev/null

WH_POST="$(curl -s -X POST "http://localhost:$PORT/api/posts" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Webhook probe","content":"Long enough to pass validation.","published":true}')"

for _ in $(seq 1 20); do
  [ -s "$WEBHOOK_LOG" ] && break
  sleep 1
done

kill "$RECEIVER_PID" 2>/dev/null || true

[ -s "$WEBHOOK_LOG" ] || { echo "$WH_POST"; fail "creating a post delivered no webhook"; }
pass "a content change delivers a webhook"

# The signature has to cover the exact bytes sent, or a receiver cannot verify
# it. Recomputing with the app's own APP_KEY is the only way to know.
APP_KEY_VALUE="$(grep '^APP_KEY=' .env | cut -d= -f2-)"

VERIFIED="$(APP_KEY_VALUE="$APP_KEY_VALUE" WEBHOOK_LOG="$WEBHOOK_LOG" node -e '
  const { readFileSync } = require("node:fs")
  const { createHmac } = require("node:crypto")
  const line = readFileSync(process.env.WEBHOOK_LOG, "utf-8").trim().split("\n")[0]
  const { event, signature, body } = JSON.parse(line)
  const expected = "sha256=" + createHmac("sha256", process.env.APP_KEY_VALUE).update(body).digest("hex")
  const payload = JSON.parse(body)
  process.stdout.write([
    signature === expected ? "signed" : "BAD-SIGNATURE",
    event,
    payload.event,
    payload.id ? "has-id" : "NO-ID"
  ].join(" "))
')"

case "$VERIFIED" in
  "signed post.created post.created has-id") pass "the delivery is signed over its exact body" ;;
  *) echo "  got: $VERIFIED"; cat "$WEBHOOK_LOG"; fail "webhook signature or payload is wrong" ;;
esac

# Leaving it configured would fire a delivery at a dead port for every later
# content change in this run.
curl -s -X PUT "http://localhost:$PORT/api/settings" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"settings":{"webhook_urls":""}}' -o /dev/null


echo ""
echo -e "${GREEN}Smoke test passed${NC}"
echo ""
