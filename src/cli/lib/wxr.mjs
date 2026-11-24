/**
 * Read a WordPress export (WXR) file into the importer's site shape.
 *
 * WXR is what Tools → Export in wp-admin produces: RSS 2.0 with WordPress's
 * own elements under the `wp:` prefix. It works offline — no API, no
 * credentials, nothing the old site has to still be running for — and it
 * carries what the REST API hides from anonymous callers: drafts, private
 * posts, author addresses, every comment and its moderation state.
 *
 * ## Mapping decisions
 *
 * Status:
 *   publish  → published (publish_at = post_date_gmt)
 *   future   → published with a future publish_at, so it goes live on time
 *   draft    → draft
 *   pending  → pending (awaiting review, as here)
 *   private  → draft. There is no "visible to logged-in editors only" state
 *              here, and publishing a private post would expose it; a draft
 *              keeps it out of public reads and in the editor.
 *   trash, auto-draft, inherit (revisions) → not imported.
 *
 * Comments: approved `1` → approved, `0` → pending, `spam` → spam (see the
 * writer for what happens without a spam column), `trash` → not imported.
 * Pingbacks and trackbacks are not imported: they are link notifications from
 * another era, not conversation, and nearly all of them are spam.
 *
 * Content: `content:encoded` is the post as the author saved it, not as the
 * site rendered it, so it goes through `autop` (WordPress adds paragraph tags
 * at display time) and the `[caption]`/`[embed]` shortcodes are expanded.
 * Other shortcodes are left visible for an editor to replace.
 *
 * SEO: Yoast's post meta (`_yoast_wpseo_*`) fills the title, description,
 * canonical, Open Graph and Twitter fields, and its noindex flag.
 */

import { parseXml, child, childrenNamed, childText, textOf } from './xml.mjs'
import { autop, expandShortcodes, plainText, decodeEntities } from './html-to-markdown.mjs'

const STATUS = { publish: 'published', future: 'published', draft: 'draft', pending: 'pending', private: 'draft' }

/**
 * @param {string} xml - the WXR file's contents
 * @returns {object} the site shape `importSite` takes, plus `meta` and `notes`
 */
export function parseWxr(xml) {
  const doc = parseXml(xml)
  const rss = child(doc, 'rss')
  const channel = child(rss, 'channel')

  if (!channel) throw new Error('Not a WordPress export: no <rss><channel>')

  const version = childText(channel, 'wp:wxr_version')
  if (!version) throw new Error('Not a WordPress export: no <wp:wxr_version>')

  const notes = []
  const site = {
    meta: {
      title: childText(channel, 'title'),
      link: childText(channel, 'link'),
      baseUrl: childText(channel, 'wp:base_blog_url') || childText(channel, 'wp:base_site_url'),
      wxrVersion: version
    },
    authors: [],
    categories: [],
    tags: [],
    media: [],
    posts: [],
    comments: [],
    notes
  }

  // Authors are keyed by login, because that is what each item's
  // `dc:creator` names. WordPress ids are kept for comments' `comment_user_id`.
  const loginByWpId = new Map()

  for (const node of childrenNamed(channel, 'wp:author')) {
    const login = childText(node, 'wp:author_login')
    if (!login) continue

    const first = childText(node, 'wp:author_first_name')
    const last = childText(node, 'wp:author_last_name')

    site.authors.push({
      key: login,
      name: childText(node, 'wp:author_display_name') || [first, last].filter(Boolean).join(' ') || login,
      email: childText(node, 'wp:author_email') || null,
      slug: login
    })

    const wpId = childText(node, 'wp:author_id')
    if (wpId) loginByWpId.set(wpId, login)
  }

  // Categories. A parent is named by its nicename (slug), which is also each
  // category's key, so hierarchy needs no id lookup.
  for (const node of childrenNamed(channel, 'wp:category')) {
    const slug = decodeURIComponent(childText(node, 'wp:category_nicename'))
    if (!slug) continue

    site.categories.push({
      key: slug,
      slug,
      name: decodeEntities(childText(node, 'wp:cat_name')) || slug,
      description: decodeEntities(childText(node, 'wp:category_description')) || null,
      parentKey: decodeURIComponent(childText(node, 'wp:category_parent')) || null
    })
  }

  for (const node of childrenNamed(channel, 'wp:tag')) {
    const slug = decodeURIComponent(childText(node, 'wp:tag_slug'))
    if (!slug) continue
    site.tags.push({ key: slug, slug, name: decodeEntities(childText(node, 'wp:tag_name')) || slug })
  }

  const knownCategories = new Set(site.categories.map((c) => c.key))
  const knownTags = new Set(site.tags.map((t) => t.key))

  const items = childrenNamed(channel, 'item')

  // Attachments first: posts refer to them by id through `_thumbnail_id`.
  for (const item of items) {
    if (childText(item, 'wp:post_type') !== 'attachment') continue

    const url = childText(item, 'wp:attachment_url') || childText(item, 'guid')
    if (!url) continue

    const meta = postMeta(item)
    const dims = attachmentDimensions(meta._wp_attachment_metadata)

    site.media.push({
      key: `attachment:${childText(item, 'wp:post_id')}`,
      url,
      alt: decodeEntities(meta._wp_attachment_image_alt || '') || null,
      width: dims.width,
      height: dims.height,
      size: dims.filesize,
      mimeType: null,
      createdAt: gmt(item, 'wp:post_date_gmt', 'wp:post_date')
    })
  }

  let skippedStatuses = 0
  let pingbacks = 0
  let otherTypes = 0

  for (const item of items) {
    const type = childText(item, 'wp:post_type')

    if (type === 'attachment') continue
    if (type !== 'post' && type !== 'page') {
      // Navigation menu items, reusable blocks, custom post types.
      otherTypes++
      continue
    }

    const wpStatus = childText(item, 'wp:status')
    const status = STATUS[wpStatus]

    if (!status) {
      skippedStatuses++
      continue
    }

    if (wpStatus === 'private') {
      notes.push(`"${childText(item, 'title')}" was private in WordPress and is imported as a draft`)
    }

    const id = childText(item, 'wp:post_id')
    const meta = postMeta(item)
    const raw = textOf(child(item, 'content:encoded'))
    const excerptRaw = textOf(child(item, 'excerpt:encoded')).trim()
    const date = gmt(item, 'wp:post_date_gmt', 'wp:post_date')
    const terms = childrenNamed(item, 'category')

    const categoryKeys = []
    const tagKeys = []

    for (const term of terms) {
      const slug = decodeURIComponent(term.attrs.nicename || '')
      const name = decodeEntities(textOf(term).trim())
      if (!slug) continue

      // A term used on a post but missing from the channel's term list —
      // WordPress omits terms in some partial exports — is added here.
      if (term.attrs.domain === 'category') {
        if (!knownCategories.has(slug)) {
          knownCategories.add(slug)
          site.categories.push({ key: slug, slug, name: name || slug, description: null, parentKey: null })
        }
        categoryKeys.push(slug)
      } else if (term.attrs.domain === 'post_tag') {
        if (!knownTags.has(slug)) {
          knownTags.add(slug)
          site.tags.push({ key: slug, slug, name: name || slug })
        }
        tagKeys.push(slug)
      }
    }

    const template = meta._wp_page_template
    const thumbnail = meta._thumbnail_id

    site.posts.push({
      key: id,
      type,
      title: decodeEntities(childText(item, 'title')),
      // A draft that was never given a slug has an empty post_name; the
      // writer derives one from the title.
      slug: decodeURIComponent(childText(item, 'wp:post_name')),
      html: autop(expandShortcodes(raw)),
      excerpt: excerptRaw ? plainText(autop(excerptRaw)) : null,
      status,
      publishAt: status === 'published' ? date : null,
      createdAt: date,
      updatedAt: gmt(item, 'wp:post_modified_gmt', 'wp:post_modified') || date,
      authorKey: childText(item, 'dc:creator') || null,
      categoryKeys,
      tagKeys,
      featuredImage: thumbnail ? `attachment:${thumbnail}` : null,
      parentKey: type === 'page' && childText(item, 'wp:post_parent') !== '0' ? childText(item, 'wp:post_parent') || null : null,
      menuOrder: Number(childText(item, 'wp:menu_order')) || 0,
      template: pageTemplate(template),
      seo: yoast(meta)
    })

    for (const node of childrenNamed(item, 'wp:comment')) {
      const approved = childText(node, 'wp:comment_approved')
      const commentType = childText(node, 'wp:comment_type')

      if (commentType === 'pingback' || commentType === 'trackback') {
        pingbacks++
        continue
      }
      if (approved === 'trash' || approved === 'post-trashed') continue

      const parent = childText(node, 'wp:comment_parent')
      const userId = childText(node, 'wp:comment_user_id')

      site.comments.push({
        key: `${id}:${childText(node, 'wp:comment_id')}`,
        postKey: id,
        parentKey: parent && parent !== '0' ? `${id}:${parent}` : null,
        authorName: decodeEntities(childText(node, 'wp:comment_author')) || null,
        authorEmail: childText(node, 'wp:comment_author_email') || null,
        userKey: userId && userId !== '0' ? loginByWpId.get(userId) ?? null : null,
        html: textOf(child(node, 'wp:comment_content')),
        status: approved === '1' ? 'approved' : approved === 'spam' ? 'spam' : 'pending',
        createdAt: gmt(node, 'wp:comment_date_gmt', 'wp:comment_date')
      })
    }
  }

  if (skippedStatuses) notes.push(`${skippedStatuses} item(s) in the trash, auto-drafts or revisions were not imported`)
  if (pingbacks) notes.push(`${pingbacks} pingback(s)/trackback(s) were not imported`)
  if (otherTypes) notes.push(`${otherTypes} item(s) of other types (menu items, blocks, custom post types) were not imported`)

  return site
}

/** `wp:postmeta` as a plain object. */
function postMeta(item) {
  const meta = {}
  for (const node of childrenNamed(item, 'wp:postmeta')) {
    const key = childText(node, 'wp:meta_key')
    if (key) meta[key] = textOf(child(node, 'wp:meta_value'))
  }
  return meta
}

/**
 * A date field, preferring the GMT one.
 *
 * WordPress stores both; the local one carries no zone, so reading it as UTC
 * is off by the site's offset. It is the fallback only because drafts can
 * have a GMT date of all zeroes.
 */
function gmt(node, gmtField, localField) {
  const value = childText(node, gmtField)
  if (value && !value.startsWith('0000')) return value
  const local = childText(node, localField)
  return local && !local.startsWith('0000') ? local : null
}

/**
 * Width, height and size out of `_wp_attachment_metadata`.
 *
 * That value is PHP's `serialize()` format. Unserializing PHP is a known way
 * to get into trouble, and only three integers are wanted, so they are read
 * with a pattern instead: the top-level `width` comes first, before the
 * `sizes` array repeats the key for every thumbnail.
 */
export function attachmentDimensions(serialized) {
  const text = String(serialized ?? '')
  const int = (key) => {
    const m = new RegExp(`s:${key.length}:"${key}";i:(\\d+);`).exec(text)
    return m ? Number(m[1]) : null
  }
  return { width: int('width'), height: int('height'), filesize: int('filesize') }
}

/** `page-templates/full-width.php` → `full-width`; WordPress's default → `default`. */
function pageTemplate(value) {
  if (!value || value === 'default') return 'default'
  return value.split('/').pop().replace(/\.php$/, '') || 'default'
}

/** Yoast SEO's post meta, mapped onto this CMS's fields. */
function yoast(meta) {
  const get = (key) => decodeEntities(meta[`_yoast_wpseo_${key}`] ?? '').trim() || null

  return {
    meta_title: stripYoastVars(get('title')),
    meta_description: stripYoastVars(get('metadesc')),
    canonical_url: get('canonical'),
    og_title: stripYoastVars(get('opengraph-title')),
    og_description: stripYoastVars(get('opengraph-description')),
    og_image: get('opengraph-image'),
    twitter_title: stripYoastVars(get('twitter-title')),
    twitter_description: stripYoastVars(get('twitter-description')),
    twitter_image: get('twitter-image'),
    noindex: meta['_yoast_wpseo_meta-robots-noindex'] === '1'
  }
}

/**
 * Yoast titles are templates (`%%title%% %%sep%% %%sitename%%`). A template
 * means nothing here, and the CMS falls back to the post's own title when the
 * field is empty, so a value that is mostly variables is dropped.
 */
function stripYoastVars(value) {
  if (!value || !value.includes('%%')) return value
  return null
}
