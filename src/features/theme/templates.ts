/**
 * The reference theme: server-rendered HTML for the public site.
 *
 * Plain functions from data to markup, built on `html` (every interpolation
 * escaped) — no template engine, no client JavaScript, no dependencies. The
 * data comes from the same `PublicContent` functions the content API uses, so
 * whatever decides what a visitor may see (published, scheduled, visibility)
 * decides it here too; nothing in this file queries the database.
 *
 * It is a reference rather than a design: semantic markup, a small inline
 * stylesheet that respects light and dark, and every head tag a crawler or a
 * link preview reads. A site wanting its own look forks this directory, or
 * goes headless and uses the content API.
 *
 * Pure, so tests render it directly.
 */

import { html, raw, jsonForScript, safeHref, type SafeHtml } from './html.ts'
import { entryPath, pagePath, categoryPath, tagPath, authorPath, termPath } from '../../helpers/content-paths.ts'
import type { PublicPost, PublicPage, PublicAuthor } from '../../models/PublicContent.ts'
import type { PublicSiteInfo } from '../../models/Settings.ts'
import type { ContentTypeRecord, FieldDefinition } from '../../models/ContentType.ts'
import type { ResponsiveImage } from '../../helpers/images.ts'

/** A menu item as Menu.publicNavigation returns it. */
export interface ThemeMenuItem {
  label: string
  url: string
  new_tab: boolean
  children: ThemeMenuItem[]
}

/** What every page needs: who the site is, where we are, and how to link. */
export interface ThemeContext {
  site: PublicSiteInfo
  /** The request path, used for the canonical URL when nothing overrides it. */
  path: string
  /** Every content type, for entry paths and custom field labels. */
  types: ContentTypeRecord[]
  /** The primary menu, if one has items. */
  menu: ThemeMenuItem[]
}

/** The head of one page, with every fallback already decided by the caller. */
export interface HeadMeta {
  title: string
  description?: string | null
  /** Absolute canonical URL. Defaults to the site URL plus the request path. */
  canonical?: string | null
  image?: string | null
  type?: 'website' | 'article' | 'profile'
  noindex?: boolean
  jsonLd?: Record<string, unknown> | null
  publishedAt?: string | null
  modifiedAt?: string | null
  /** Separate share-card text, when the entry set one. */
  og?: { title: string; description: string | null } | null
  twitter?: { title: string; description: string | null; image: string | null } | null
  /** The page's own absolute URL, when it can be embedded — adds oEmbed discovery. */
  embeddable?: string | null
  prev?: string | null
  next?: string | null
}

// --- Paths ----------------------------------------------------------------

/** An entry's path on this site, whatever its content type. */
export function pathOf(ctx: Pick<ThemeContext, 'types'>, post: Pick<PublicPost, 'slug' | 'id' | 'type'>): string {
  const type = ctx.types.find((candidate) => candidate.key === post.type)
  return entryPath(type?.builtin ? null : type?.route_base, post.slug, post.id)
}

function absolute(ctx: ThemeContext, path: string): string {
  return `${ctx.site.url}${path}`
}

// --- Fragments --------------------------------------------------------------

/**
 * A responsive <img>: width and height so the page does not jump as it loads,
 * a srcset when IMAGE_TRANSFORM_URL is configured, lazy below the fold.
 */
export function responsiveImg(image: ResponsiveImage | null, options: { sizes?: string; eager?: boolean; alt?: string } = {}): SafeHtml | '' {
  if (!image) return ''

  return html`<img src="${image.url}"${image.srcset ? html` srcset="${image.srcset}" sizes="${options.sizes ?? '(max-width: 760px) 100vw, 760px'}"` : ''}${
    image.width ? html` width="${image.width}"` : ''}${image.height ? html` height="${image.height}"` : ''} alt="${image.alt ?? options.alt ?? ''}" ${
    options.eager ? raw('fetchpriority="high"') : raw('loading="lazy"')} decoding="async">`
}

function formatDate(ctx: ThemeContext, iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(ctx.site.locale || 'en', { dateStyle: 'long', timeZone: ctx.site.timezone || 'UTC' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

function timeTag(ctx: ThemeContext, iso: string | null | undefined): SafeHtml | '' {
  const text = formatDate(ctx, iso)
  return text ? html`<time datetime="${iso}">${text}</time>` : ''
}

function menuItems(items: ThemeMenuItem[]): SafeHtml {
  return html`<ul>${items.map((item) => html`<li><a href="${safeHref(item.url)}"${item.new_tab ? raw(' target="_blank" rel="noopener"') : ''}>${item.label}</a>${
    item.children.length ? menuItems(item.children) : ''}</li>`)}</ul>`
}

/** One entry in a listing. */
export function card(ctx: ThemeContext, post: PublicPost): SafeHtml {
  const href = pathOf(ctx, post)
  return html`<article class="card">
  ${post.featured_image ? html`<a class="card-image" href="${href}" tabindex="-1" aria-hidden="true">${responsiveImg(post.featured_image, { sizes: '(max-width: 760px) 100vw, 240px' })}</a>` : ''}
  <div>
    <h2><a href="${href}">${post.title}</a></h2>
    <p class="meta">${timeTag(ctx, post.published_at)}${post.author ? html` · ${post.author}` : ''}</p>
    ${post.excerpt ? html`<p>${post.excerpt}</p>` : ''}
  </div>
</article>`
}

function pager(page: number, totalPages: number, base: string): SafeHtml | '' {
  if (totalPages <= 1) return ''
  const link = (n: number) => (n <= 1 ? base : `${base}${base.includes('?') ? '&' : '?'}page=${n}`)
  return html`<nav class="pager" aria-label="Pagination">
  ${page > 1 ? html`<a rel="prev" href="${link(page - 1)}">← Newer</a>` : html`<span></span>`}
  <span>Page ${page} of ${totalPages}</span>
  ${page < totalPages ? html`<a rel="next" href="${link(page + 1)}">Older →</a>` : html`<span></span>`}
</nav>`
}

/** Value of one custom field, as a reader should see it. */
function fieldValue(ctx: ThemeContext, field: FieldDefinition, value: unknown): SafeHtml | string {
  switch (field.type) {
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'url':
      return html`<a href="${safeHref(String(value))}" rel="noopener">${String(value)}</a>`
    case 'date':
      return formatDate(ctx, `${value}T00:00:00Z`) || String(value)
    case 'textarea':
      // Plain text with its line breaks kept; never markup.
      return html`${String(value).split('\n').map((line, index) => (index ? html`<br>${line}` : line))}`
    default:
      return String(value)
  }
}

function customFields(ctx: ThemeContext, post: PublicPost): SafeHtml | '' {
  const values = post.fields
  if (!values) return ''
  const type = ctx.types.find((candidate) => candidate.key === post.type)
  const defined = (type?.fields ?? []).filter((field) => values[field.key] !== undefined)
  if (!defined.length) return ''

  return html`<dl class="fields">${defined.map((field) => html`<div><dt>${field.label}</dt><dd>${fieldValue(ctx, field, values[field.key])}</dd></div>`)}</dl>`
}

function termLinks(post: PublicPost): SafeHtml | '' {
  const groups = [
    ...(post.categories.length ? [{ label: 'Filed under', links: post.categories.map((c) => ({ href: categoryPath(c.slug), name: c.name })) }] : []),
    ...(post.tags.length ? [{ label: 'Tags', links: post.tags.map((t) => ({ href: tagPath(t.slug), name: t.name })) }] : []),
    ...Object.entries(post.terms).map(([taxonomy, terms]) => ({
      label: taxonomy.replace(/_/g, ' '),
      links: terms.map((term) => ({ href: termPath(taxonomy, term.slug), name: term.name }))
    }))
  ]
  if (!groups.length) return ''

  return html`<footer class="terms">${groups.map((group) => html`<p><span>${group.label}:</span> ${group.links.map((link, index) => html`${index ? ', ' : ''}<a href="${link.href}">${link.name}</a>`)}</p>`)}</footer>`
}

// --- The document -------------------------------------------------------------

const STYLES = `
:root{color-scheme:light dark;--fg:#1d1d1f;--muted:#5f6368;--bg:#fff;--line:#e5e5e5;--accent:#2457c5}
@media (prefers-color-scheme:dark){:root{--fg:#ececec;--muted:#a3a3a3;--bg:#141414;--line:#2a2a2a;--accent:#8fb0ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}img{max-width:100%;height:auto}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
.site-header{border-bottom:1px solid var(--line);padding:1rem 0}.site-header .wrap{display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between}
.brand{font-weight:700;text-decoration:none;color:var(--fg);display:flex;gap:.5rem;align-items:center}.brand img{height:32px;width:auto}
.site-header nav ul{list-style:none;display:flex;flex-wrap:wrap;gap:1rem;margin:0;padding:0}.site-header nav ul ul{display:none}
main{padding:2rem 0}h1{line-height:1.2;margin:.25rem 0 1rem}.meta{color:var(--muted);font-size:.9rem;margin:0}
.card{display:grid;grid-template-columns:1fr;gap:1rem;padding:1.25rem 0;border-bottom:1px solid var(--line)}
@media (min-width:600px){.card:has(.card-image){grid-template-columns:240px 1fr}}
.card h2{margin:0;font-size:1.25rem;line-height:1.3}.card h2 a{color:var(--fg);text-decoration:none}.card p{margin:.4rem 0 0}
.hero{margin:0 0 1.5rem}.content{overflow-wrap:break-word}.content pre{overflow-x:auto}
.fields{display:grid;gap:.5rem;border:1px solid var(--line);border-radius:8px;padding:1rem;margin:1.5rem 0}.fields div{display:flex;gap:1rem}.fields dt{font-weight:600;min-width:8rem}.fields dd{margin:0}
.terms{border-top:1px solid var(--line);margin-top:2rem;padding-top:1rem;color:var(--muted)}.terms span{text-transform:capitalize}
.author{display:flex;gap:1rem;align-items:center}.author img{border-radius:50%}
.pager{display:flex;justify-content:space-between;padding:1.5rem 0;color:var(--muted)}
.site-footer{border-top:1px solid var(--line);padding:1.5rem 0;color:var(--muted);font-size:.9rem}
`

/** Everything in <head> a browser, a crawler or a link preview reads. */
export function renderHead(ctx: ThemeContext, meta: HeadMeta): SafeHtml {
  const site = ctx.site
  const canonical = meta.canonical || absolute(ctx, ctx.path)
  const title = meta.title === site.name ? site.name : `${meta.title} — ${site.name}`
  const description = meta.description || site.description || null
  const image = meta.image || site.default_social_image_url
  const og = meta.og ?? { title: meta.title, description }
  const twitter = meta.twitter ?? { title: og.title, description: og.description, image }

  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description ? html`<meta name="description" content="${description}">` : ''}
<link rel="canonical" href="${canonical}">
${meta.noindex ? raw('<meta name="robots" content="noindex">') : ''}
${site.icon_url ? html`<link rel="icon" href="${site.icon_url}">` : ''}
<link rel="alternate" type="application/rss+xml" title="${site.name}" href="${absolute(ctx, '/feed.xml')}">
<link rel="alternate" type="application/feed+json" title="${site.name}" href="${absolute(ctx, '/feed.json')}">
${meta.embeddable ? html`<link rel="alternate" type="application/json+oembed" href="${absolute(ctx, `/oembed?url=${encodeURIComponent(meta.embeddable)}&format=json`)}" title="${meta.title}">` : ''}
${meta.prev ? html`<link rel="prev" href="${meta.prev}">` : ''}
${meta.next ? html`<link rel="next" href="${meta.next}">` : ''}
<meta property="og:site_name" content="${site.name}">
<meta property="og:type" content="${meta.type ?? 'website'}">
<meta property="og:title" content="${og.title}">
${og.description ? html`<meta property="og:description" content="${og.description}">` : ''}
<meta property="og:url" content="${canonical}">
${image ? html`<meta property="og:image" content="${image}">` : ''}
<meta property="og:locale" content="${site.locale.replace('-', '_')}">
${meta.publishedAt ? html`<meta property="article:published_time" content="${meta.publishedAt}">` : ''}
${meta.modifiedAt ? html`<meta property="article:modified_time" content="${meta.modifiedAt}">` : ''}
<meta name="twitter:card" content="${twitter.image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${twitter.title}">
${twitter.description ? html`<meta name="twitter:description" content="${twitter.description}">` : ''}
${twitter.image ? html`<meta name="twitter:image" content="${twitter.image}">` : ''}
${meta.jsonLd ? html`<script type="application/ld+json">${jsonForScript(meta.jsonLd)}</script>` : ''}
<style>${raw(STYLES)}</style>
${raw(site.code_injection.head)}`
}

/** The whole page around a body. */
export function documentHtml(ctx: ThemeContext, meta: HeadMeta, body: SafeHtml): string {
  const site = ctx.site
  return `<!doctype html>\n${html`<html lang="${site.locale || 'en'}">
<head>
${renderHead(ctx, meta)}
</head>
<body>
<header class="site-header"><div class="wrap">
  <a class="brand" href="/">${site.logo_url ? html`<img src="${site.logo_url}" alt="">` : ''}<span>${site.name}</span></a>
  ${ctx.menu.length ? html`<nav aria-label="Primary">${menuItems(ctx.menu)}</nav>` : ''}
</div></header>
<main id="content"><div class="wrap">
${body}
</div></main>
<footer class="site-footer"><div class="wrap">
  <p>© ${new Date().getUTCFullYear()} ${site.name} · <a href="/feed.xml">RSS</a></p>
</div></footer>
${raw(site.code_injection.foot)}
</body>
</html>`}\n`
}

// --- Pages --------------------------------------------------------------------

export interface ListingView {
  title: string
  /** Shown under the heading: a category description, an author bio. */
  intro?: string | null
  posts: PublicPost[]
  page: number
  totalPages: number
  /** The listing's own path, without `?page=`. */
  basePath: string
  /** The home page and a type archive are the site; archives are collections. */
  heading?: boolean
  author?: PublicAuthor | null
}

/** The home page, a type archive, or a category/tag/author/term archive. */
export function renderListing(ctx: ThemeContext, view: ListingView): string {
  const pageUrl = (n: number) => absolute(ctx, n <= 1 ? view.basePath : `${view.basePath}?page=${n}`)
  const isHome = view.basePath === '/'

  const body = html`
${view.heading === false ? '' : html`<header>
  ${view.author ? html`<div class="author">${view.author.avatar_url ? html`<img src="${view.author.avatar_url}" alt="" width="64" height="64">` : ''}<h1>${view.title}</h1></div>` : html`<h1>${view.title}</h1>`}
  ${view.intro ? html`<p class="meta">${view.intro}</p>` : ''}
</header>`}
${view.posts.length ? view.posts.map((post) => card(ctx, post)) : html`<p>Nothing here yet.</p>`}
${pager(view.page, view.totalPages, view.basePath)}`

  return documentHtml(ctx, {
    title: isHome && view.page <= 1 ? ctx.site.name : view.page > 1 ? `${view.title} (page ${view.page})` : view.title,
    description: view.intro || ctx.site.description,
    canonical: pageUrl(view.page),
    type: view.author ? 'profile' : 'website',
    prev: view.page > 1 ? pageUrl(view.page - 1) : null,
    next: view.page < view.totalPages ? pageUrl(view.page + 1) : null,
    jsonLd: isHome
      ? { '@context': 'https://schema.org', '@type': 'WebSite', name: ctx.site.name, url: absolute(ctx, '/'), ...(ctx.site.description ? { description: ctx.site.description } : {}) }
      : { '@context': 'https://schema.org', '@type': 'CollectionPage', name: view.title, url: pageUrl(view.page) }
  }, body)
}

/** One entry: a blog post or an entry of a custom content type. */
export function renderEntry(ctx: ThemeContext, post: PublicPost): string {
  const url = absolute(ctx, pathOf(ctx, post))

  const body = html`<article>
  <header>
    <h1>${post.title}</h1>
    <p class="meta">${timeTag(ctx, post.published_at)}${post.author_profile?.slug
      ? html` · <a href="${authorPath(post.author_profile.slug)}">${post.author_profile.name}</a>`
      : post.author ? html` · ${post.author}` : ''}</p>
  </header>
  ${post.featured_image ? html`<figure class="hero">${responsiveImg(post.featured_image, { eager: true, alt: '' })}</figure>` : ''}
  ${customFields(ctx, post)}
  ${post.gated
    // The theme always renders the anonymous view, so a members-only entry
    // is its excerpt (when it is a teaser, not the whole body) and a notice —
    // never an empty article that reads as a broken page.
    ? html`<div class="content">${post.excerpt ? html`<p>${post.excerpt}</p>` : ''}<p class="gated"><em>This post is for members.</em></p></div>`
    : html`<div class="content">${post.format === 'html' ? raw(post.content) : html`<p>${post.content}</p>`}</div>`}
  ${termLinks(post)}
</article>`

  return documentHtml(ctx, {
    title: post.meta_title || post.title,
    description: post.meta_description || post.excerpt,
    canonical: post.canonical_url || url,
    image: post.og.image_url,
    type: 'article',
    noindex: post.noindex,
    jsonLd: post.structured_data,
    publishedAt: post.published_at,
    modifiedAt: post.updated_at,
    og: { title: post.og.title, description: post.og.description },
    twitter: { title: post.twitter.title, description: post.twitter.description, image: post.twitter.image_url },
    embeddable: url
  }, body)
}

/** A page. */
export function renderPage(ctx: ThemeContext, page: PublicPage): string {
  const url = absolute(ctx, pagePath(page.slug))

  const body = html`<article>
  <h1>${page.title}</h1>
  ${page.featured_image ? html`<figure class="hero">${responsiveImg(page.featured_image, { eager: true, alt: '' })}</figure>` : ''}
  <div class="content">${page.format === 'html' ? raw(page.content) : html`<p>${page.content}</p>`}</div>
</article>`

  return documentHtml(ctx, {
    title: page.meta_title || page.title,
    description: page.meta_description,
    canonical: page.canonical_url || url,
    image: page.og.image_url,
    noindex: page.noindex,
    og: { title: page.og.title, description: page.og.description },
    twitter: { title: page.twitter.title, description: page.twitter.description, image: page.twitter.image_url },
    modifiedAt: page.updated_at,
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, url, dateModified: page.updated_at },
    embeddable: url
  }, body)
}

/** The 404. Indexed by nobody. */
export function renderNotFound(ctx: ThemeContext): string {
  return documentHtml(ctx, { title: 'Page not found', noindex: true }, html`<h1>Page not found</h1>
<p>There is nothing at this address. Try the <a href="/">home page</a>.</p>`)
}
