#!/bin/bash

# Test script for BasicBen framework
# Creates a test app, runs dev server, tests endpoints/frontend, builds, and tests production
#
# Usage:
#   ./scripts/test-app.sh              # Scaffold and test an app
#   ./scripts/test-app.sh --skip-setup # Skip app creation (use existing my-test-app)
#
# There is one template (TypeScript); --typescript/--ts are accepted and ignored.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/my-test-app"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Parse flags
SKIP_SETUP=""
for arg in "$@"; do
  case $arg in
    --typescript|--ts)
      # Accepted and ignored — TypeScript is the only template.
      ;;
    --skip-setup)
      SKIP_SETUP="true"
      ;;
  esac
done

# Helper functions
log_info() {
  echo -e "${CYAN}$1${NC}"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

log_section() {
  echo ""
  echo -e "${BOLD}=== $1 ===${NC}"
  echo ""
}

# Test helper - run a test and track result
run_test() {
  local name="$1"
  local cmd="$2"
  local expected="$3"

  result=$(eval "$cmd" 2>&1) || true

  if echo "$result" | grep -q "$expected"; then
    log_success "$name"
    ((TESTS_PASSED++))
    return 0
  else
    log_error "$name"
    echo -e "  ${DIM}Expected: $expected${NC}"
    echo -e "  ${DIM}Got: ${result:0:100}...${NC}"
    ((TESTS_FAILED++))
    return 1
  fi
}

# Test HTTP endpoint
test_endpoint() {
  local name="$1"
  local method="$2"
  local url="$3"
  local data="$4"
  local expected="$5"
  local auth="$6"

  local curl_opts="-s -w '\n%{http_code}'"

  if [ -n "$auth" ]; then
    curl_opts="$curl_opts -H 'Authorization: Bearer $auth'"
  fi

  if [ "$method" == "POST" ] || [ "$method" == "PUT" ]; then
    curl_opts="$curl_opts -X $method -H 'Content-Type: application/json' -d '$data'"
  fi

  response=$(eval "curl $curl_opts '$url'" 2>&1) || true

  if echo "$response" | grep -q "$expected"; then
    log_success "$name"
    ((TESTS_PASSED++))
    return 0
  else
    log_error "$name"
    echo -e "  ${DIM}Expected: $expected${NC}"
    echo -e "  ${DIM}Response: ${response:0:200}${NC}"
    ((TESTS_FAILED++))
    return 1
  fi
}

# Wait for server to be ready
wait_for_server() {
  local url="$1"
  local max_attempts="${2:-30}"
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    if curl -s "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
    ((attempt++))
  done

  return 1
}

# Cleanup function
cleanup() {
  log_info "Cleaning up..."

  # Kill any running servers
  if [ -n "$DEV_PID" ]; then
    kill $DEV_PID 2>/dev/null || true
    wait $DEV_PID 2>/dev/null || true
  fi

  if [ -n "$PROD_PID" ]; then
    kill $PROD_PID 2>/dev/null || true
    wait $PROD_PID 2>/dev/null || true
  fi

  # Kill any processes on test ports
  lsof -ti:3001 | xargs kill -9 2>/dev/null || true
  lsof -ti:3002 | xargs kill -9 2>/dev/null || true
  lsof -ti:3003 | xargs kill -9 2>/dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

# ============================================================
# SETUP
# ============================================================

if [ "$SKIP_SETUP" != "true" ]; then
  log_section "BasicBen Integration Tests"

  # Delete existing my-test-app
  if [ -d "$APP_DIR" ]; then
    log_info "Removing existing my-test-app..."
    rm -rf "$APP_DIR"
  fi

  # Create new test app
  log_info "Creating test app..."
  cd "$ROOT_DIR"
  node create-basicben-app/index.js my-test-app --local

  # Configure .env
  log_info "Configuring .env..."
  APP_KEY=$(openssl rand -base64 32)
  cat > "$APP_DIR/.env" << EOF
APP_KEY=$APP_KEY
PORT=3001
VITE_PORT=3002
DATABASE_URL=./database.sqlite
EOF

  # Install dependencies
  log_info "Installing dependencies..."
  cd "$APP_DIR"
  npm install --silent

  # Run migrations
  log_info "Running migrations..."
  npm run migrate --silent
else
  log_section "BasicBen Integration Tests (Skip Setup)"
  cd "$APP_DIR"
fi

# ============================================================
# DEV SERVER TESTS
# ============================================================

log_section "Development Server Tests"

# Start dev server in background
log_info "Starting dev server..."
npm run dev > /tmp/basicben-dev.log 2>&1 &
DEV_PID=$!

# Wait for servers to be ready
log_info "Waiting for servers..."
if ! wait_for_server "http://localhost:3001/feed.json" 30; then
  log_error "API server failed to start"
  cat /tmp/basicben-dev.log
  exit 1
fi

if ! wait_for_server "http://localhost:3002" 30; then
  log_error "Vite server failed to start"
  exit 1
fi

log_success "Servers started"
echo ""

# Test API endpoints
log_info "Testing API endpoints..."

# Generate unique email for this test run
TEST_EMAIL="test-$(date +%s)@example.com"

# Auth register
REGISTER_RESPONSE=$(curl -s -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test User\",\"email\":\"$TEST_EMAIL\",\"password\":\"password123\"}")

if echo "$REGISTER_RESPONSE" | grep -q "token"; then
  log_success "POST /api/auth/register returns token"
  ((TESTS_PASSED++))
  AUTH_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
else
  log_error "POST /api/auth/register failed"
  echo -e "  ${DIM}Response: $REGISTER_RESPONSE${NC}"
  ((TESTS_FAILED++))
fi

# Auth login (use same email as register)
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"password123\"}")

if echo "$LOGIN_RESPONSE" | grep -q "token"; then
  log_success "POST /api/auth/login returns token"
  ((TESTS_PASSED++))
  AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
else
  log_error "POST /api/auth/login failed"
  ((TESTS_FAILED++))
fi

# Authenticated endpoints (if we have a token)
if [ -n "$AUTH_TOKEN" ]; then
  # Get posts (should be empty array)
  POSTS_RESPONSE=$(curl -s http://localhost:3001/api/posts \
    -H "Authorization: Bearer $AUTH_TOKEN")

  if echo "$POSTS_RESPONSE" | grep -q "\["; then
    log_success "GET /api/posts (authenticated) returns array"
    ((TESTS_PASSED++))
  else
    log_error "GET /api/posts (authenticated) failed"
    ((TESTS_FAILED++))
  fi

  # Create a post (title + content, content must be at least 10 chars)
  CREATE_POST=$(curl -s -X POST http://localhost:3001/api/posts \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Test Post","content":"This is a test post content that is long enough"}')

  if echo "$CREATE_POST" | grep -q "Test Post"; then
    log_success "POST /api/posts creates post"
    ((TESTS_PASSED++))
    POST_ID=$(echo "$CREATE_POST" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
  else
    log_error "POST /api/posts failed"
    echo -e "  ${DIM}Response: $CREATE_POST${NC}"
    ((TESTS_FAILED++))
  fi

  # ---- Categories API ----
  echo ""
  log_info "Testing Categories API..."

  # Get categories
  CATEGORIES_RESPONSE=$(curl -s http://localhost:3001/api/categories \
    -H "Authorization: Bearer $AUTH_TOKEN")

  if echo "$CATEGORIES_RESPONSE" | grep -q "\["; then
    log_success "GET /api/categories returns array"
    ((TESTS_PASSED++))
  else
    log_error "GET /api/categories failed"
    ((TESTS_FAILED++))
  fi

  # Create category
  CREATE_CATEGORY=$(curl -s -X POST http://localhost:3001/api/categories \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Test Category","slug":"test-category"}')

  if echo "$CREATE_CATEGORY" | grep -q "Test Category"; then
    log_success "POST /api/categories creates category"
    ((TESTS_PASSED++))
  else
    log_error "POST /api/categories failed"
    echo -e "  ${DIM}Response: $CREATE_CATEGORY${NC}"
    ((TESTS_FAILED++))
  fi

  # ---- Tags API ----
  echo ""
  log_info "Testing Tags API..."

  # Get tags
  TAGS_RESPONSE=$(curl -s http://localhost:3001/api/tags \
    -H "Authorization: Bearer $AUTH_TOKEN")

  if echo "$TAGS_RESPONSE" | grep -q "\["; then
    log_success "GET /api/tags returns array"
    ((TESTS_PASSED++))
  else
    log_error "GET /api/tags failed"
    ((TESTS_FAILED++))
  fi

  # Create tag
  CREATE_TAG=$(curl -s -X POST http://localhost:3001/api/tags \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Test Tag","slug":"test-tag"}')

  if echo "$CREATE_TAG" | grep -q "Test Tag"; then
    log_success "POST /api/tags creates tag"
    ((TESTS_PASSED++))
  else
    log_error "POST /api/tags failed"
    echo -e "  ${DIM}Response: $CREATE_TAG${NC}"
    ((TESTS_FAILED++))
  fi

  # ---- Pages API ----
  echo ""
  log_info "Testing Pages API..."

  # Get pages
  PAGES_RESPONSE=$(curl -s http://localhost:3001/api/pages \
    -H "Authorization: Bearer $AUTH_TOKEN")

  if echo "$PAGES_RESPONSE" | grep -q "\["; then
    log_success "GET /api/pages returns array"
    ((TESTS_PASSED++))
  else
    log_error "GET /api/pages failed"
    ((TESTS_FAILED++))
  fi

  # Create page
  CREATE_PAGE=$(curl -s -X POST http://localhost:3001/api/pages \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"About Us","slug":"about","content":"This is our about page content."}')

  if echo "$CREATE_PAGE" | grep -q "About Us"; then
    log_success "POST /api/pages creates page"
    ((TESTS_PASSED++))
  else
    log_error "POST /api/pages failed"
    echo -e "  ${DIM}Response: $CREATE_PAGE${NC}"
    ((TESTS_FAILED++))
  fi

  # ---- Comments API ----
  echo ""
  log_info "Testing Comments API..."

  if [ -n "$POST_ID" ]; then
    # Get comments for post
    COMMENTS_RESPONSE=$(curl -s "http://localhost:3001/api/posts/$POST_ID/comments")

    if echo "$COMMENTS_RESPONSE" | grep -q "\["; then
      log_success "GET /api/posts/:id/comments returns array"
      ((TESTS_PASSED++))
    else
      log_error "GET /api/posts/:id/comments failed"
      ((TESTS_FAILED++))
    fi

    # Create comment (requires author_name and author_email)
    CREATE_COMMENT=$(curl -s -X POST "http://localhost:3001/api/posts/$POST_ID/comments" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"content":"This is a test comment on the post.","author_name":"Test User","author_email":"test@example.com"}')

    if echo "$CREATE_COMMENT" | grep -q "test comment"; then
      log_success "POST /api/posts/:id/comments creates comment"
      ((TESTS_PASSED++))
    else
      log_error "POST /api/posts/:id/comments failed"
      echo -e "  ${DIM}Response: $CREATE_COMMENT${NC}"
      ((TESTS_FAILED++))
    fi
  else
    log_info "Skipping comments tests (no post ID)"
  fi

  # ---- Media API ----
  echo ""
  log_info "Testing Media API..."

  # Get media
  MEDIA_RESPONSE=$(curl -s http://localhost:3001/api/media \
    -H "Authorization: Bearer $AUTH_TOKEN")

  if echo "$MEDIA_RESPONSE" | grep -q "\["; then
    log_success "GET /api/media returns array"
    ((TESTS_PASSED++))
  else
    log_error "GET /api/media failed"
    ((TESTS_FAILED++))
  fi

  # ---- Settings API ----
  echo ""
  log_info "Testing Settings API..."

  # Get settings
  SETTINGS_RESPONSE=$(curl -s http://localhost:3001/api/settings \
    -H "Authorization: Bearer $AUTH_TOKEN")

  if echo "$SETTINGS_RESPONSE" | grep -q "settings"; then
    log_success "GET /api/settings returns settings object"
    ((TESTS_PASSED++))
  else
    log_error "GET /api/settings failed"
    ((TESTS_FAILED++))
  fi


fi

# ---- Feed Endpoints (Public) ----
echo ""
log_info "Testing Feed endpoints..."

# RSS Feed
RSS_RESPONSE=$(curl -s http://localhost:3001/feed.xml)
if echo "$RSS_RESPONSE" | grep -q "xml\|rss\|channel"; then
  log_success "GET /feed.xml returns RSS feed"
  ((TESTS_PASSED++))
else
  log_error "GET /feed.xml failed"
  ((TESTS_FAILED++))
fi

# JSON Feed
JSON_FEED=$(curl -s http://localhost:3001/feed.json)
if echo "$JSON_FEED" | grep -q "version\|title\|items"; then
  log_success "GET /feed.json returns JSON feed"
  ((TESTS_PASSED++))
else
  log_error "GET /feed.json failed"
  ((TESTS_FAILED++))
fi

# Sitemap
SITEMAP=$(curl -s http://localhost:3001/sitemap.xml)
if echo "$SITEMAP" | grep -q "xml\|urlset\|url"; then
  log_success "GET /sitemap.xml returns sitemap"
  ((TESTS_PASSED++))
else
  log_error "GET /sitemap.xml failed"
  ((TESTS_FAILED++))
fi

# Unauthenticated should fail
UNAUTH_RESPONSE=$(curl -s http://localhost:3001/api/posts)
if echo "$UNAUTH_RESPONSE" | grep -qi "unauthorized\|error\|401"; then
  log_success "GET /api/posts (unauthenticated) returns 401"
  ((TESTS_PASSED++))
else
  log_error "GET /api/posts (unauthenticated) should return 401"
  ((TESTS_FAILED++))
fi

echo ""

# Test Frontend
log_info "Testing frontend..."

# Check Vite serves HTML
FRONTEND_RESPONSE=$(curl -s http://localhost:3002)
if echo "$FRONTEND_RESPONSE" | grep -q "<html\|<!DOCTYPE"; then
  log_success "Frontend serves HTML"
  ((TESTS_PASSED++))
else
  log_error "Frontend should serve HTML"
  ((TESTS_FAILED++))
fi

# Check React app loads (script tag present)
if echo "$FRONTEND_RESPONSE" | grep -q "src/main"; then
  log_success "Frontend includes React entry point"
  ((TESTS_PASSED++))
else
  log_error "Frontend should include React entry point"
  ((TESTS_FAILED++))
fi

# Stop dev server
log_info "Stopping dev server..."
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
DEV_PID=""
sleep 2

# ============================================================
# BUILD TESTS
# ============================================================

log_section "Build Tests"

log_info "Running build..."
if npm run build > /tmp/basicben-build.log 2>&1; then
  log_success "Build completed successfully"
  ((TESTS_PASSED++))
else
  log_error "Build failed"
  cat /tmp/basicben-build.log
  ((TESTS_FAILED++))
fi

# Check build output exists
if [ -f "$APP_DIR/dist/client/index.html" ]; then
  log_success "Client build output exists (dist/client/index.html)"
  ((TESTS_PASSED++))
else
  log_error "Client build output missing"
  ((TESTS_FAILED++))
fi

if [ -f "$APP_DIR/dist/server/index.js" ]; then
  log_success "Server build output exists (dist/server/index.js)"
  ((TESTS_PASSED++))
else
  log_error "Server build output missing"
  ((TESTS_FAILED++))
fi

# ============================================================
# PRODUCTION SERVER TESTS
# ============================================================

log_section "Production Server Tests"

# Start production server
log_info "Starting production server..."
PORT=3003 npm run start > /tmp/basicben-prod.log 2>&1 &
PROD_PID=$!

# Wait for server
if ! wait_for_server "http://localhost:3003" 15; then
  log_error "Production server failed to start"
  cat /tmp/basicben-prod.log
  ((TESTS_FAILED++))
else
  log_success "Production server started"
  ((TESTS_PASSED++))

  # Test production endpoints
  PROD_FEED=$(curl -s http://localhost:3003/feed.json)
  if echo "$PROD_FEED" | grep -q "\["; then
    log_success "Production API responds (/feed.json)"
    ((TESTS_PASSED++))
  else
    log_error "Production API not responding"
    ((TESTS_FAILED++))
  fi

  # Test static files served
  PROD_HTML=$(curl -s http://localhost:3003/)
  if echo "$PROD_HTML" | grep -q "<html\|<!DOCTYPE"; then
    log_success "Production serves static files"
    ((TESTS_PASSED++))
  else
    log_error "Production should serve static files"
    ((TESTS_FAILED++))
  fi
fi

# Stop production server
kill $PROD_PID 2>/dev/null || true
wait $PROD_PID 2>/dev/null || true
PROD_PID=""

# ============================================================
# RESULTS
# ============================================================

log_section "Test Results"

TOTAL=$((TESTS_PASSED + TESTS_FAILED))

echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo -e "Total:  $TOTAL"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}Some tests failed${NC}"
  exit 1
fi
