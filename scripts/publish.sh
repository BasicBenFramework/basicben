#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

# Get current version
# The repository root is a private workspace with no version of its own; core
# is the package whose number this release names.
CURRENT_VERSION=$(node -p "require('./packages/core/package.json').version")

echo -e "${YELLOW}Current version: ${NC}$CURRENT_VERSION"
echo ""

# Get new version from argument or prompt
if [ -n "$1" ]; then
  NEW_VERSION="$1"
else
  echo "Enter new version (or press enter for options):"
  read -r NEW_VERSION

  if [ -z "$NEW_VERSION" ]; then
    echo ""
    echo "Version bump options:"
    echo "  1) patch (x.x.X)"
    echo "  2) minor (x.X.0)"
    echo "  3) major (X.0.0)"
    echo ""
    read -p "Select [1-3]: " BUMP_TYPE

    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

    case $BUMP_TYPE in
      1) NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
      2) NEW_VERSION="$MAJOR.$((MINOR + 1)).0" ;;
      3) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
      *) echo -e "${RED}Invalid option${NC}"; exit 1 ;;
    esac
  fi
fi

# Validate semver format
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${RED}Error: Invalid version format. Use semver (e.g., 1.2.3)${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}Publishing version: ${NC}$NEW_VERSION"
echo ""

# Confirm
read -p "Continue? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${RED}Error: You have uncommitted changes. Please commit or stash them first.${NC}"
  exit 1
fi

# Check we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo -e "${YELLOW}Warning: You're on branch '$CURRENT_BRANCH', not 'main'.${NC}"
  read -p "Continue anyway? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Update every versioned package. apps/cms is private and never published, but
# it is the CMS this release ships, so it carries the same number rather than
# drifting into meaninglessness.
for TARGET in packages/core packages/create apps/cms; do
  echo -e "${GREEN}Updating version in $TARGET/package.json...${NC}"
  node -e "
const fs = require('fs');
const path = './$TARGET/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"
done

# The lockfile records workspace versions, so it moves with them.
npm install --package-lock-only > /dev/null 2>&1 || true

# Commit
echo -e "${GREEN}Committing changes...${NC}"
git add packages/core/package.json packages/create/package.json apps/cms/package.json package-lock.json
git commit -m "v$NEW_VERSION"

# Tag
echo -e "${GREEN}Creating tag v$NEW_VERSION...${NC}"
git tag "v$NEW_VERSION"

# Push
echo -e "${GREEN}Pushing to origin...${NC}"
# The branch and the new tag only. `--tags` pushes every tag at once, and
# GitHub creates no events when more than three arrive together — so the
# release tag lands but the publish workflow never fires.
git push origin "$CURRENT_BRANCH"
git push origin "v$NEW_VERSION"

echo ""
echo -e "${GREEN}✓ Done!${NC}"
echo ""
echo "GitHub Actions will now:"
echo "  1. Run tests"
echo "  2. Publish @basicbenframework/core"
echo "  3. Publish @basicbenframework/create"
echo ""
echo "Watch the workflow at:"
echo "  https://github.com/BasicBenFramework/basicben/actions"
