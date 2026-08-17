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

# A plugin that exercises the extension points, installed before the build so
# it is discovered at boot like a real one.
mkdir -p "$APP_NAME/plugins"
cat > "$APP_NAME/plugins/probe.js" <<'PROBE'
export default {
  name: 'probe',
  version: '1.0.0',
  hooks: {
    'post.creating': async (data) => ({ ...data, title: `[hooked] ${data.title}` }),
    'content.save': async (html) => `${html}<p data-probe="1"></p>`,
    'admin.menu': async (items) => [...items, { path: '/admin/probe', label: 'Probe' }],
    'server.started': async () => { console.log('PROBE:server.started') }
  },
  initialize: async () => { console.log('PROBE:initialized') },
  routes: (router) => {
    router.get('/api/probe', (req, res) => res.json({ ok: true }))
  }
}
PROBE

# A plugin that throws, to prove one bad plugin cannot disable the others.
cat > "$APP_NAME/plugins/broken.js" <<'BROKEN'
export default {
  name: 'broken',
  version: '1.0.0',
  hooks: { 'post.created': async () => { throw new Error('deliberate') } }
}
BROKEN

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

npx basicben migrate > /dev/null 2>&1 || fail "migrations failed"
pass "ran migrations"

# --- Plugin activation --------------------------------------------------------
#
# This used to print a tick directly beneath "is not registered" and exit 0,
# because activate() returned false and the CLI never looked at it.

if npx basicben plugin activate does-not-exist > "$WORK_DIR/activate.log" 2>&1; then
  cat "$WORK_DIR/activate.log"
  fail "activating a missing plugin exited 0"
fi
pass "activating a missing plugin fails loudly"

npx basicben plugin activate probe > /dev/null 2>&1 || fail "could not activate the probe plugin"
npx basicben plugin activate broken > /dev/null 2>&1 || true
pass "activated a plugin from the CLI"

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

# The activation must have survived the CLI process and been read back at boot.
grep -q "PROBE:initialized" "$WORK_DIR/server.log" \
  || { cat "$WORK_DIR/server.log"; fail "the plugin was never activated at boot"; }
pass "plugins activate at boot from the stored list"

grep -q "PROBE:server.started" "$WORK_DIR/server.log" \
  || fail "server.started never fired — it only fires from app.start(), which nothing calls"
pass "server.started fires"

# Only the TypeScript template ships a themes/ directory; loadThemes() returns
# early when there is none, which is correct rather than a failure.
grep -qi "Loaded themes" "$WORK_DIR/server.log" \
  || fail "loadThemes() is not being called"
pass "themes load at boot"

# Two themes, so switching and the partial-implementation fallback have
# something real to exercise. `minimal` implements two layouts and inherits
# the rest from `default`.
grep -qi "Loaded themes.*minimal" "$WORK_DIR/server.log" \
  || fail "the second theme was not discovered"
pass "more than one theme is installed"

# Each theme's layouts must be separate chunks, or lazy loading buys nothing.
ARCHIVE_CHUNKS="$(find dist/client/assets -name 'ArchiveLayout-*.js' 2>/dev/null | wc -l | tr -d ' ')"
[ "$ARCHIVE_CHUNKS" = "2" ] \
  || fail "expected one ArchiveLayout chunk per theme, found $ARCHIVE_CHUNKS"
pass "each theme's layouts are code-split separately"

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

for path in /api/settings /api/plugins /api/themes; do
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
VERIFY_URL="$(grep -o 'http://localhost:3000/verify/[A-Za-z0-9_-]*' "$WORK_DIR/server.log" | tail -1)"
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

if node "$ROOT_DIR/scripts/passkey-smoke.mjs" \
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
# typed, which the theme then rendered with dangerouslySetInnerHTML — so the
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

# The plugin's filters must have altered what was actually written.
case "$CREATED" in
  *'[hooked] Markdown test'*) pass "post.creating filtered the write" ;;
  *) echo "$CREATED"; fail "post.creating did not alter the stored title" ;;
esac

case "$CREATED" in
  *'data-probe'*) pass "content.save filtered the stored HTML" ;;
  *) fail "content.save did not affect what was stored" ;;
esac

grep -qi 'Hook "post.created" (broken' "$WORK_DIR/server.log" \
  && pass "a failing hook is reported with the plugin that caused it" \
  || fail "a failing plugin hook was swallowed, or does not name the plugin"

PROBE_ROUTE="$(curl -s "http://localhost:$PORT/api/probe")"
case "$PROBE_ROUTE" in
  *'"ok"'*) pass "plugin routes are mounted" ;;
  *) echo "$PROBE_ROUTE"; fail "the plugin's route was never registered" ;;
esac

# The admin API only exists in the TypeScript template.
MENU="$(curl -s "http://localhost:$PORT/api/admin/menu" -H "Authorization: Bearer $OWNER_TOKEN")"
case "$MENU" in
  *'/admin/probe'*) pass "a plugin can extend the admin menu" ;;
  *) echo "$MENU"; fail "admin.menu did not reach the UI" ;;
esac
case "$MENU" in
  *'/admin/posts'*) pass "and the built-in menu items survive" ;;
  *) fail "the plugin replaced the menu instead of extending it" ;;
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

# The owner's token: uploading needs the media.upload capability, which a
# subscriber does not have. It was minted at registration, so the login
# lockout above does not affect it — a lockout stops new sign-ins, not tokens
# already issued.
node "$ROOT_DIR/scripts/storage-smoke.mjs" "http://localhost:$PORT" "$OWNER_TOKEN" \
  || fail "storage smoke test failed"

echo ""
echo -e "${GREEN}Smoke test passed${NC}"
echo ""
