# Theme

The reference public site, rendered on the server, and the oEmbed provider.

Off by default. Turn it on with **Settings → Public site** (`public_theme` =
`ssr`) or `PUBLIC_THEME=ssr`; `PUBLIC_THEME=off` forces it off whatever the
setting says. With `DISABLE_PUBLIC_SITE=true` none of its routes exist.

It serves the home page, posts at `/blog/:slug`, pages and custom types at
their route bases, category, tag, author and taxonomy archives, and
`/oembed`. Pages are plain HTML with canonical links, Open Graph and
Twitter tags, JSON-LD, feed and oEmbed discovery, and the site's code
injection. Templates escape every interpolation unless it is marked safe
(`html.ts`).

It reads content only through `PublicContent`, so it shows exactly what the
content API shows: live posts, and restricted bodies withheld the way the
access policy decides. A withheld entry shows its excerpt and a notice.

## Removing it

Delete this folder and its line in each of the three feature lists. The CMS
then runs headless: the content API, feeds, sitemap and the admin are core
and carry on. A stored `public_theme` setting is left in the database,
unused. The theme must stay last in `src/features.ts`: its `/:slug` and
`/:base/:slug` routes would catch anything mounted after them.
