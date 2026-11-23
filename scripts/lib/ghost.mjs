/**
 * Read a Ghost export (Settings → Labs → Export, Ghost 4 and 5) into the
 * importer's site shape.
 *
 * ## Mapping decisions
 *
 * Body: Ghost stores Lexical (5) or Mobiledoc (4) JSON and renders it to the
 * `html` column, which the export includes. That HTML is what readers saw, so
 * it is the source, converted to Markdown like every other import. A post
 * with no `html` falls back to a Mobiledoc Markdown card if it has one, then
 * to `plaintext`. Lexical and Mobiledoc are not interpreted beyond that —
 * they are editor document formats, and their rendered HTML says the same
 * thing.
 *
 * Tags: Ghost has only tags. Every public tag becomes a tag here. Internal
 * tags (`#name`) are Ghost's private labels for routing and theming, not
 * something a reader sees, so they are not imported.
 *
 * Primary tag: a Ghost post's first tag is its "primary tag", which Ghost
 * themes and routes use the way other CMSes use a category — the breadcrumb,
 * the `/{primary_tag}/{slug}/` permalink. So by default the primary tag is
 * *also* created as a category and set as the post's primary category; the
 * tag stays a tag too, so nothing is lost. `primaryTagAsCategory: false`
 * turns this off.
 *
 * Status: published → published; scheduled → published with a future
 * publish_at; draft → draft; sent (email-only newsletter, never on the web)
 * → draft, so it does not suddenly appear on the site.
 *
 * Members-only and paid posts are imported as ordinary posts: there is no
 * content gating here. Each is counted in the notes so nothing is published
 * that was behind a paywall without someone noticing.
 *
 * Images: Ghost writes `__GHOST_URL__` in exported URLs. Pass `siteUrl` to
 * resolve it; without it those images keep a relative path and a note says so.
 */

const STATUS = { published: 'published', scheduled: 'published', draft: 'draft', sent: 'draft' }

/**
 * @param {object|string} input - the parsed export, or its JSON text
 * @param {object} [options]
 * @param {string} [options.siteUrl] - replaces `__GHOST_URL__`
 * @param {boolean} [options.primaryTagAsCategory] - default true
 */
export function parseGhost(input, options = {}) {
  const json = typeof input === 'string' ? JSON.parse(input) : input
  // Ghost wraps the export in `db: [ … ]`; some tools unwrap it.
  const root = Array.isArray(json?.db) ? json.db[0] : json
  const data = root?.data

  if (!data || !Array.isArray(data.posts)) throw new Error('Not a Ghost export: no data.posts')

  const meta = root.meta ?? {}
  const notes = []
  const primaryAsCategory = options.primaryTagAsCategory !== false
  const siteUrl = options.siteUrl?.replace(/\/$/, '')

  let unresolvedUrls = 0
  const url = (value) => {
    if (!value) return null
    if (value.includes('__GHOST_URL__')) {
      if (!siteUrl) {
        unresolvedUrls++
        return null
      }
      return value.replaceAll('__GHOST_URL__', siteUrl)
    }
    return value
  }
  const html = (value) => (value && siteUrl ? value.replaceAll('__GHOST_URL__', siteUrl) : value)

  // Tags
  const tags = data.tags ?? []
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const isInternal = (tag) => tag.visibility === 'internal' || String(tag.name ?? '').startsWith('#')

  const site = {
    meta: { version: meta.version ?? null, exportedOn: meta.exported_on ?? null },
    authors: [],
    categories: [],
    tags: tags.filter((t) => !isInternal(t)).map((t) => ({ key: t.id, slug: t.slug, name: t.name })),
    media: [],
    posts: [],
    comments: [],
    notes
  }

  // Authors. Ghost's roles are not carried over: everyone arrives as `author`.
  for (const user of data.users ?? []) {
    site.authors.push({
      key: user.id,
      name: user.name,
      email: user.email || null,
      slug: user.slug,
      bio: user.bio || null,
      website: user.website || null,
      avatarUrl: url(user.profile_image),
      createdAt: user.created_at
    })
  }

  // Join tables, in sort order: the first tag and the first author are the
  // primary ones.
  const byPost = (rows, field) => {
    const map = new Map()
    for (const row of [...(rows ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
      if (!map.has(row.post_id)) map.set(row.post_id, [])
      map.get(row.post_id).push(row[field])
    }
    return map
  }

  const postTags = byPost(data.posts_tags, 'tag_id')
  const postAuthors = byPost(data.posts_authors, 'author_id')
  // Ghost 4+ moved the SEO fields to their own table; Ghost 3 kept them on the post.
  const postsMeta = new Map((data.posts_meta ?? []).map((m) => [m.post_id, m]))

  const primaryCategories = new Map()
  let gated = 0
  let skipped = 0

  for (const post of data.posts) {
    const status = STATUS[post.status]

    if (!status) {
      skipped++
      continue
    }

    if (post.status === 'sent') notes.push(`"${post.title}" was an email-only newsletter and is imported as a draft`)
    if (post.visibility && post.visibility !== 'public') gated++

    const seo = { ...post, ...(postsMeta.get(post.id) ?? {}) }
    const tagIds = (postTags.get(post.id) ?? []).filter((id) => tagById.has(id) && !isInternal(tagById.get(id)))

    const categoryKeys = []
    if (primaryAsCategory && post.type !== 'page' && tagIds.length) {
      const primary = tagById.get(tagIds[0])
      const key = `category:${primary.id}`
      if (!primaryCategories.has(key)) {
        primaryCategories.set(key, { key, slug: primary.slug, name: primary.name, description: primary.description || null })
      }
      categoryKeys.push(key)
    }

    const body = html(post.html) || markdownCard(post.mobiledoc)
    const bodyIsMarkdown = !post.html && Boolean(body)

    site.posts.push({
      key: post.id,
      type: post.type === 'page' ? 'page' : 'post',
      title: post.title,
      slug: post.slug,
      html: bodyIsMarkdown ? null : body || null,
      markdown: bodyIsMarkdown ? body : body ? undefined : post.plaintext || '',
      excerpt: post.custom_excerpt || null,
      status,
      publishAt: status === 'published' ? post.published_at : null,
      createdAt: post.created_at,
      updatedAt: post.updated_at,
      authorKey: (postAuthors.get(post.id) ?? [])[0] ?? post.author_id ?? null,
      categoryKeys,
      tagKeys: tagIds,
      featuredImage: url(post.feature_image),
      template: 'default',
      seo: {
        meta_title: seo.meta_title || null,
        meta_description: seo.meta_description || null,
        og_title: seo.og_title || null,
        og_description: seo.og_description || null,
        og_image: url(seo.og_image),
        twitter_title: seo.twitter_title || null,
        twitter_description: seo.twitter_description || null,
        twitter_image: url(seo.twitter_image),
        canonical_url: post.canonical_url || null,
        noindex: false
      }
    })

    if (post.feature_image && seo.feature_image_alt) {
      const featured = url(post.feature_image)
      if (featured) site.media.push({ url: featured, alt: seo.feature_image_alt })
    }
  }

  site.categories = [...primaryCategories.values()]

  if (gated) notes.push(`${gated} post(s) were members-only or paid in Ghost; there is no content gating here, so they are imported as ordinary posts`)
  if (skipped) notes.push(`${skipped} post(s) with an unrecognised status were not imported`)
  if (unresolvedUrls) notes.push(`${unresolvedUrls} image URL(s) used __GHOST_URL__; pass --url https://your-ghost-site to resolve them`)

  return site
}

/**
 * The Markdown inside a Mobiledoc document's Markdown card, if it has one.
 *
 * Ghost 1–3 posts written in the Markdown editor are a single such card. Used
 * only when the export has no `html` for a post (hand-trimmed exports, some
 * migration tools), since the rendered HTML includes every other card too.
 */
export function markdownCard(mobiledoc) {
  try {
    const doc = typeof mobiledoc === 'string' ? JSON.parse(mobiledoc) : mobiledoc
    const parts = (doc?.cards ?? [])
      .filter(([name]) => name === 'markdown' || name === 'card-markdown')
      .map(([, payload]) => payload?.markdown)
      .filter(Boolean)
    return parts.length ? parts.join('\n\n') : null
  } catch {
    return null
  }
}
