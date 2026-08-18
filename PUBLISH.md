# Publishing to npm

Two packages are published from this workspace:

| Package | Source | Notes |
|---|---|---|
| `@basicbenframework/core` | `packages/core` | The framework. |
| `@basicbenframework/create` | `packages/create` | The scaffolder. Its `prepack` copies `apps/cms` into `./template-ts` so the tarball is self-contained; that snapshot is generated at publish time and gitignored, so the repo keeps exactly one copy of the CMS. |

`apps/cms` is private and never published — it is the CMS itself, and people get
it by cloning this repo or by running the scaffolder.

Publish by workspace name. A bare `npm publish` at the repository root targets
the private workspace root rather than a package, which is a confusing failure.

## Quick Release

Once Trusted Publishing is configured, use the release script:

```bash
# Interactive mode (prompts for version)
npm run release

# Or specify version directly
./scripts/publish.sh 0.2.0
```

The script will:
1. Prompt for new version (or offer patch/minor/major bump)
2. Update both `package.json` files
3. Commit and tag
4. Push to origin → triggers GitHub Actions

---

## First Publish (Manual)

Packages must exist before configuring Trusted Publishing.

```bash
# Login to npm
npm login

# Publish both, by workspace name. A bare `npm publish` at the repository
# root would target the private workspace root, not a package.
npm publish --workspace @basicbenframework/core --access public
npm publish --workspace @basicbenframework/create --access public
```

## Setup Trusted Publishing

After packages exist, configure OIDC for automated releases.

1. Go to [npmjs.com](https://www.npmjs.com) → Package Settings → Publishing Access
2. Click "Add Linked Provider" → GitHub Actions
3. Repository: `BasicBenFramework/core`
4. Repeat for both packages:
   - `@basicbenframework/core`
   - `@basicbenframework/create`

## Manual Publishing

If you prefer not to use the script:

1. **Update version numbers**
   ```bash
   # Edit the version in all three:
   # - /packages/core/package.json     (@basicbenframework/core)
   # - /packages/create/package.json   (@basicbenframework/create)
   # - /apps/cms/package.json          (private, but ships with the release)
   ```

2. **Commit and tag**
   ```bash
   git add .
   git commit -m "v0.1.0"
   git tag v0.1.0
   git push origin main --tags
   ```

3. **GitHub Actions will automatically**
   - Run tests
   - Publish both packages to npm

## Packages

| Package | Description |
|---------|-------------|
| `@basicbenframework/core` | Framework core |
| `@basicbenframework/create` | `npx @basicbenframework/create my-app` |
