/**
 * WordPress REST API responses → the importer's site shape.
 *
 * Kept apart from the fetching in `basicben-cms import:wordpress` so the
 * mapping can be tested against recorded responses without a WordPress.
 *
 * The REST API returns *rendered* HTML (`content.rendered`), unlike a WXR
 * file, so no `autop` is needed: this is what the site showed.
 *
 * Anonymous requests see only published content, approved comments and the
 * public half of each author — no email address. With WORDPRESS_AUTH set
 * (an application password) the script also asks for drafts, scheduled,
 * pending and private posts, held and spam comments, and author addresses.
 */

import { decodeEntities, plainText } from './html-to-markdown.mjs'

const STATUS = { publish: 'published', future: 'published', draft: 'draft', pending: 'pending', private: 'draft' }
const COMMENT_STATUS = { approved: 'approved', approve: 'approved', hold: 'pending', unapproved: 'pending', spam: 'spam' }

/** WordPress dates are local-with-no-zone; `date_gmt` is the one to trust. */
function gmt(item, field = 'date') {
  const value = item[`${field}_gmt`]
  return value ? `${value}Z` : item[field] ?? null
}

/**
 * @param {object} data
 * @param {object[]} data.posts - `/wp/v2/posts?_embed`
 * @param {object[]} [data.pages] - `/wp/v2/pages?_embed`
 * @param {object[]} [data.media] - `/wp/v2/media`
 * @param {object[]} [data.comments] - `/wp/v2/comments`
 * @param {object[]} [data.users] - `/wp/v2/users`
 * @param {object[]} [data.categories] - `/wp/v2/categories`
 */
export function mapRestSite(data) {
  const notes = []
  const site = { authors: [], categories: [], tags: [], media: [], posts: [], comments: [], notes }

  for (const user of data.users ?? []) {
    site.authors.push({
      key: String(user.id),
      name: decodeEntities(user.name ?? ''),
      email: user.email || null,
      slug: user.slug,
      bio: decodeEntities(user.description ?? '') || null,
      website: user.url || null
    })
  }

  // Categories from their own endpoint carry parent and description, which
  // the post embed does not; embedded terms fill in any it missed.
  const categoryIds = new Map()
  for (const term of data.categories ?? []) {
    categoryIds.set(term.id, term.slug)
  }
  for (const term of data.categories ?? []) {
    site.categories.push({
      key: term.slug,
      slug: term.slug,
      name: decodeEntities(term.name ?? ''),
      description: decodeEntities(term.description ?? '') || null,
      parentKey: term.parent ? categoryIds.get(term.parent) ?? null : null
    })
  }

  const seenCategories = new Set(site.categories.map((c) => c.key))
  const seenTags = new Set()

  for (const item of data.media ?? []) {
    if (!item.source_url) continue
    site.media.push({
      key: `attachment:${item.id}`,
      url: item.source_url,
      alt: decodeEntities(item.alt_text || '') || null,
      mimeType: item.mime_type || null,
      // The media endpoint reports these; the featured-image embed does not.
      size: Number(item.media_details?.filesize) || null,
      width: Number(item.media_details?.width) || null,
      height: Number(item.media_details?.height) || null,
      createdAt: gmt(item)
    })
  }

  const mediaKeys = new Set(site.media.map((m) => m.key))

  const mapItem = (item, type) => {
    const status = STATUS[item.status] ?? null
    if (!status) return null

    if (item.status === 'private') notes.push(`"${decodeEntities(item.title?.rendered ?? '')}" was private in WordPress and is imported as a draft`)

    const terms = item._embedded?.['wp:term'] ?? []
    const categoryKeys = []
    const tagKeys = []

    for (const group of terms) {
      for (const term of group ?? []) {
        if (!term?.slug) continue
        if (term.taxonomy === 'category') {
          if (!seenCategories.has(term.slug)) {
            seenCategories.add(term.slug)
            site.categories.push({ key: term.slug, slug: term.slug, name: decodeEntities(term.name ?? ''), description: null, parentKey: null })
          }
          categoryKeys.push(term.slug)
        } else if (term.taxonomy === 'post_tag') {
          if (!seenTags.has(term.slug)) {
            seenTags.add(term.slug)
            site.tags.push({ key: term.slug, slug: term.slug, name: decodeEntities(term.name ?? '') })
          }
          tagKeys.push(term.slug)
        }
      }
    }

    // The featured image: the library's row when the library was fetched,
    // otherwise the embed's URL, which makes a sparser row.
    const featured = item._embedded?.['wp:featuredmedia']?.[0]
    const featuredKey = item.featured_media ? `attachment:${item.featured_media}` : null
    const featuredImage = featuredKey && mediaKeys.has(featuredKey)
      ? featuredKey
      : featured?.source_url && !featured.code ? featured.source_url : null

    const yoast = item.yoast_head_json ?? {}
    const date = gmt(item)

    return {
      key: `${type}:${item.id}`,
      type,
      title: decodeEntities(item.title?.rendered ?? ''),
      slug: decodeURIComponent(item.slug ?? ''),
      html: item.content?.rendered ?? '',
      excerpt: type === 'post' ? plainText(item.excerpt?.rendered) || null : null,
      status,
      publishAt: status === 'published' ? date : null,
      createdAt: date,
      updatedAt: gmt(item, 'modified') || date,
      authorKey: item.author ? String(item.author) : null,
      categoryKeys,
      tagKeys,
      featuredImage,
      parentKey: type === 'page' && item.parent ? `page:${item.parent}` : null,
      menuOrder: item.menu_order ?? 0,
      template: item.template ? item.template.split('/').pop().replace(/\.php$/, '') : 'default',
      seo: {
        // Yoast's head data is fully resolved (no %%templates%%), so it is
        // usable as-is — but its title is usually just "Post — Site", which
        // the CMS produces by itself, so only a distinct one is kept.
        meta_title: yoast.title && yoast.title !== yoast.og_title ? decodeEntities(yoast.title) : null,
        meta_description: yoast.description ? decodeEntities(yoast.description) : null,
        canonical_url: yoast.canonical && yoast.canonical !== item.link ? yoast.canonical : null,
        og_title: null,
        og_description: null,
        og_image: null,
        twitter_title: null,
        twitter_description: null,
        twitter_image: null,
        noindex: yoast.robots?.index === 'noindex'
      }
    }
  }

  for (const item of data.posts ?? []) {
    const mapped = mapItem(item, 'post')
    if (mapped) site.posts.push(mapped)
  }

  for (const item of data.pages ?? []) {
    const mapped = mapItem(item, 'page')
    if (mapped) site.posts.push(mapped)
  }

  for (const comment of data.comments ?? []) {
    if (comment.type && comment.type !== 'comment') continue // pingbacks, trackbacks

    site.comments.push({
      key: String(comment.id),
      postKey: `post:${comment.post}`,
      parentKey: comment.parent ? String(comment.parent) : null,
      authorName: decodeEntities(comment.author_name ?? '') || null,
      authorEmail: comment.author_email || null,
      userKey: comment.author ? String(comment.author) : null,
      html: comment.content?.rendered ?? '',
      status: COMMENT_STATUS[comment.status] ?? 'pending',
      createdAt: gmt(comment)
    })
  }

  return site
}
