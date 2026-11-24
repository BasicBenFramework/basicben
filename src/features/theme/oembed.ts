/**
 * The oEmbed response body, from what the controller found.
 *
 * Pure — the size arithmetic and the card markup are the parts worth testing,
 * and neither needs a database. See OEmbedController for the request side.
 */

import { html } from './html.ts'

export interface OEmbedTarget {
  /** `rich` for posts and custom-type entries, `link` for pages. */
  kind: 'rich' | 'link'
  title: string
  description: string | null
  authorName: string | null
  /** Site-relative; made absolute against the provider URL. */
  authorUrl: string | null
  thumbnail: { url: string; width: number | null; height: number | null } | null
}

/** The card's natural size, before a consumer's maxwidth/maxheight. */
const CARD_WIDTH = 600
const CARD_HEIGHT = 200
/** How long a consumer may keep the response, in seconds (oEmbed `cache_age`). */
const CACHE_AGE = 3600

/**
 * Fit `width × height` inside the bounds, keeping the aspect ratio. Never
 * scales up: a consumer that asks for at most 1200 wide has not asked for a
 * 600-pixel image to be stretched.
 */
export function fit(width: number, height: number, maxWidth: number | null, maxHeight: number | null): { width: number; height: number } {
  let scale = 1
  if (maxWidth && width > maxWidth) scale = Math.min(scale, maxWidth / width)
  if (maxHeight && height > maxHeight) scale = Math.min(scale, maxHeight / height)
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

export function resolveOEmbed(input: OEmbedTarget & {
  url: string
  providerName: string
  providerUrl: string
  maxWidth: number | null
  maxHeight: number | null
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    version: '1.0',
    type: input.kind,
    title: input.title,
    provider_name: input.providerName,
    provider_url: input.providerUrl,
    cache_age: CACHE_AGE,
    ...(input.authorName ? { author_name: input.authorName } : {}),
    ...(input.authorUrl ? { author_url: `${input.providerUrl}${input.authorUrl}` } : {})
  }

  // A thumbnail is only offered when it can be shown to fit. The spec says
  // the thumbnail must respect maxwidth/maxheight too, and an image of unknown
  // size cannot be promised to.
  const thumb = input.thumbnail
  if (thumb) {
    if (thumb.width && thumb.height) {
      const size = fit(thumb.width, thumb.height, input.maxWidth, input.maxHeight)
      Object.assign(body, { thumbnail_url: thumb.url, thumbnail_width: size.width, thumbnail_height: size.height })
    } else if (!input.maxWidth && !input.maxHeight) {
      body.thumbnail_url = thumb.url
    }
  }

  if (input.kind === 'rich') {
    const size = fit(CARD_WIDTH, CARD_HEIGHT, input.maxWidth, input.maxHeight)
    // Every value escaped: this string is inserted into someone else's page
    // as markup, and the title is whatever an author typed.
    const card = html`<blockquote class="basicben-embed" style="max-width:${size.width}px;margin:0;padding:1em;border-left:4px solid #ccc"><p><a href="${input.url}">${input.title}</a></p>${
      input.description ? html`<p>${input.description}</p>` : ''}<p>— ${input.authorName ? html`${input.authorName}, ` : ''}<a href="${input.providerUrl}">${input.providerName}</a></p></blockquote>`
    Object.assign(body, { html: card.value, width: size.width, height: size.height })
  }

  return body
}
