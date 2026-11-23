/**
 * Read an image's dimensions, and its real format, from its first bytes.
 *
 * Every format worth uploading puts its size in a fixed or near-fixed place in
 * its header, so this needs no image library — only a few hundred bytes for
 * PNG, GIF and WebP, and the marker segments before the first frame for JPEG.
 * AVIF is ISOBMFF; its `ispe` box carries the size.
 *
 * The detected format also checks the upload: a file whose bytes are not the
 * image type it was declared as is refused at confirm time, which is what
 * stops an HTML or SVG document being stored behind an `image/png` label.
 */

export interface ImageInfo {
  type: 'image/png' | 'image/gif' | 'image/jpeg' | 'image/webp' | 'image/avif'
  width: number
  height: number
}

export function imageSize(bytes: Uint8Array): ImageInfo | null {
  const b = bytes
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const ascii = (offset: number, length: number) =>
    offset + length <= b.length ? String.fromCharCode(...b.subarray(offset, offset + length)) : ''

  // PNG: signature, then IHDR with big-endian width and height.
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
    return valid({ type: 'image/png', width: view.getUint32(16), height: view.getUint32(20) })
  }

  // GIF: logical screen size, little-endian.
  if (b.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return valid({ type: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) })
  }

  // WebP: RIFF container, three chunk flavours.
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4)
    if (chunk === 'VP8 ') {
      return valid({ type: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff })
    }
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true)
      return valid({ type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 })
    }
    if (chunk === 'VP8X') {
      const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16))
      const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16))
      return valid({ type: 'image/webp', width, height })
    }
    return null
  }

  // JPEG: walk the marker segments to the first start-of-frame.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) return null
      const marker = b[offset + 1]
      // Fill bytes and standalone markers carry no length.
      if (marker === 0xff) { offset++; continue }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
      const length = view.getUint16(offset + 2)
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) {
        return valid({ type: 'image/jpeg', height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) })
      }
      if (length < 2) return null
      offset += 2 + length
    }
    return null
  }

  // AVIF: an `ftyp` brand of avif/avis, then an `ispe` box somewhere in meta.
  if (b.length >= 12 && ascii(4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 4))) {
    for (let i = 0; i + 20 <= b.length; i++) {
      if (b[i] === 0x69 && ascii(i, 4) === 'ispe') {
        return valid({ type: 'image/avif', width: view.getUint32(i + 8), height: view.getUint32(i + 12) })
      }
    }
    return null
  }

  return null
}

function valid(info: ImageInfo): ImageInfo | null {
  const ok = (n: number) => Number.isInteger(n) && n > 0 && n <= 100_000
  return ok(info.width) && ok(info.height) ? info : null
}
