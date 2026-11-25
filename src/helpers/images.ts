/**
 * Responsive image URLs, without resizing anything here.
 *
 * Making smaller copies of an image needs an image library — native (sharp) or
 * WASM — and this project ships no runtime dependencies. Every CDN worth using
 * already resizes on request, so instead of storing variants this builds URLs
 * for one: set IMAGE_TRANSFORM_URL to a template and each image gets a srcset.
 *
 *   Cloudflare  https://example.com/cdn-cgi/image/width={width},format=auto/{url}
 *   imgix       {url}?w={width}&auto=format
 *   Bunny       {url}?width={width}
 *   imgproxy    https://imgproxy.example.com/insecure/rs:fit:{width}/plain/{url}
 *
 * `{url}` is the original's absolute URL and `{width}` the target width; add
 * `{url_encoded}` if the service wants it encoded. Unset, images get their
 * dimensions and no srcset, which is still enough to stop layout shift.
 */

import { configValue } from './config.ts'

const WIDTHS = [320, 640, 960, 1280, 1920, 2560]

export interface ResponsiveImage {
  url: string
  width: number | null
  height: number | null
  alt: string | null
  srcset: string | null
}

export function responsiveImage(
  url: string | null,
  meta: { width?: number | null; height?: number | null; alt?: string | null } = {}
): ResponsiveImage | null {
  if (!url) return null

  const width = meta.width ? Number(meta.width) : null
  const height = meta.height ? Number(meta.height) : null
  const template = configValue('IMAGE_TRANSFORM_URL')

  let srcset: string | null = null
  if (template && width) {
    // Never upscale: offer the steps below the original, then the original.
    const steps = WIDTHS.filter((w) => w < width)
    srcset = [
      ...steps.map((w) => `${transform(template, url, w)} ${w}w`),
      `${transform(template, url, width)} ${width}w`
    ].join(', ')
  }

  return { url, width, height, alt: meta.alt ?? null, srcset }
}

function transform(template: string, url: string, width: number): string {
  return template
    .replaceAll('{url_encoded}', encodeURIComponent(url))
    .replaceAll('{url}', url)
    .replaceAll('{width}', String(width))
}
