# A BasicBen site

This site runs the BasicBen CMS, installed as `@basicbenframework/cms`. It
holds only what is its own: configuration, deploy files, and any mail
templates or migrations it adds.

```
basicben.config.js    defineSite({ features, cors, mail, storage })
vite.config.ts        plugins: [cms()]
src/server/index.ts   the CMS's server
src/main.ts           the CMS's admin
index.html            title and favicon
vercel.json           Vercel, with the public theme on
vercel.headless.json  Vercel, API and admin only (rename to vercel.json)
api/index.js          the Vercel function
mail/                 optional: a file here replaces the CMS's of that name
db/migrations/        optional: the site's own, from `basicben make:migration`
```

## Start

```bash
cp .env.example .env   # then set APP_KEY
npm install
npm run migrate
npm run dev
```

## Features

`features` in `basicben.config.js` turns the CMS's features on, in the order
their routes mount: `analytics`, `members`, `mysendbox`, `theme` (last). An
empty list is the bare core: the admin and the content API.

## Updating

```bash
npm install @basicbenframework/cms@latest
npm run migrate
```

## Tools

`npx basicben-cms export | import:json | import:wxr | import:ghost |
import:wordpress | backup | restore`. Each takes `--help`. The npm scripts in
`package.json` run them.
