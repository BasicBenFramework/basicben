# Publishing to npm

One package is published from this repository:

| Package | Source | Notes |
|---|---|---|
| `@basicbenframework/create` | `create/` | The scaffolder. Its `prepack` copies the repository root into `./template-ts` so the tarball is self-contained; that snapshot is generated at publish time and gitignored, so there is still exactly one copy of the CMS. |

The CMS itself — this repository — is private and never published. People get it
by cloning, or by running the scaffolder.

`@basicbenframework/core` is published from
[its own repository](https://github.com/BasicBenFramework/core).

Publish from the `create/` directory, not the root: the root package is the CMS
and is marked private.

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

# The scaffolder is published from its own directory. The repository root is
# the CMS and is marked private, so publishing there fails by design.
cd create && npm publish --access public
```

## Setup Trusted Publishing

After packages exist, configure OIDC for automated releases.

> **If the repository moves, this must be updated first.** npm authorises a
> specific repository to publish a package. Publishing 0.5.1 from the new
> monorepo failed with `404 Not Found - PUT ... or you do not have permission`
> — which is npm's response to an unrecognised publisher, not a missing
> package. The tarball built and the provenance was signed; only the final PUT
> was refused.

1. Go to [npmjs.com](https://www.npmjs.com) → Package Settings → Publishing Access
2. Click "Add Linked Provider" → GitHub Actions
3. Repository: `BasicBenFramework/basicben`
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
