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
# Usage: ./scripts/smoke-test.sh [--ts]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORK_DIR="$(mktemp -d)"
PORT="${SMOKE_PORT:-3987}"
SERVER_PID=""
TS_FLAG=""
APP_NAME="smoke-js"

if [ "${1:-}" = "--ts" ]; then
  TS_FLAG="--typescript"
  APP_NAME="smoke-ts"
fi

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
node package/index.js "$APP_NAME" $TS_FLAG > /dev/null

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

npx basicben build > /dev/null 2>&1 || fail "build failed"
[ -f dist/client/index.html ] || fail "dist/client/index.html missing after build"
[ -f dist/server/index.js ] || fail "dist/server/index.js missing after build"
pass "built client and server"

npx basicben migrate > /dev/null 2>&1 || fail "migrations failed"
pass "ran migrations"

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
if [ "$APP_NAME" = "smoke-ts" ]; then
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
fi

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

if [ "$APP_NAME" = "smoke-ts" ]; then
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
fi

echo ""
echo -e "${GREEN}Smoke test passed${NC}"
echo ""
