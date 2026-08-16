/**
 * Media library.
 *
 * Uploads go straight from the browser to object storage. This controller signs
 * a URL and records a row; the file bytes never pass through Node.
 *
 * That is a replacement for the previous approach rather than a repair of it.
 * The hand-rolled multipart parser here could not have worked: the global body
 * parser drains every non-GET request before a controller runs, so it attached
 * its listeners to an already-ended stream and its promise never resolved. It
 * also read `req._raw`, which nothing ever set. Underneath that, the body
 * limit was 1 MB while this file advertised 10 MB, and uploads were written to
 * `public/uploads` while production serves `dist/client`.
 *
 * The two-step flow removes all four problems at once, and works the same
 * against R2, S3, MinIO or the local disk.
 */

import { signUpload, confirmUpload, deleteUpload } from '@basicbenframework/core/storage/uploads'
import { getStorage } from '@basicbenframework/core/storage'
import { Media } from '../models/Media'
import type { Request, Response } from '../types'

const MAX_FILE_SIZE = 10 * 1024 * 1024

export const MediaController = {
  async index(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1
    const perPage = parseInt(req.query.per_page as string) || 20
    const { items, total } = await Media.all(page, perPage)

    res.json({
      media: await withUrls(items),
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: Math.ceil(total / perPage)
      }
    })
  },

  async show(req: Request, res: Response) {
    const media = await Media.find(parseInt(req.params.id))
    if (!media) {
      return res.json({ error: 'Media not found' }, 404)
    }

    res.json({ media: (await withUrls([media]))[0] })
  },

  /**
   * Step one: hand back a URL the browser can PUT to.
   *
   * The content type and declared size are checked here, because a caller
   * without a signed URL cannot upload at all — this is the enforcement point,
   * not a courtesy check.
   */
  async sign(req: Request, res: Response) {
    const { filename, contentType, size } = req.body as {
      filename?: string
      contentType?: string
      size?: number
    }

    const result = await signUpload(
      { filename: filename as string, contentType: contentType as string, size: size as number, userId: req.userId },
      { maxSize: MAX_FILE_SIZE }
    )

    if (!result.ok) {
      return res.json({ error: result.error }, 422)
    }

    res.json({
      uploadUrl: result.uploadUrl,
      key: result.key,
      ticket: result.ticket,
      headers: result.headers,
      expiresAt: result.expiresAt
    })
  },

  /**
   * Step two: verify the upload landed, then record it.
   *
   * Everything is checked against the bucket rather than against the request.
   * By this point the caller has been to the bucket and back, so every field it
   * sends is attacker-controlled — including the key.
   */
  async confirm(req: Request, res: Response) {
    const { key, ticket, filename, altText } = req.body as {
      key?: string
      ticket?: string
      filename?: string
      altText?: string
    }

    const result = await confirmUpload(
      { key: key as string, ticket: ticket as string, userId: req.userId },
      { maxSize: MAX_FILE_SIZE }
    )

    if (!result.ok) {
      return res.json({ error: result.error }, 422)
    }

    const media = await Media.create({
      user_id: req.userId,
      filename: result.key as string,
      original_name: filename || (result.key as string).split('/').pop() || 'file',
      path: result.key as string,
      mime_type: result.contentType,
      size: result.size,
      alt_text: altText
    })

    res.json({ media: { ...media, url: result.url } }, 201)
  },

  async update(req: Request, res: Response) {
    const media = await Media.find(parseInt(req.params.id))
    if (!media) {
      return res.json({ error: 'Media not found' }, 404)
    }

    const { alt_text } = req.body as { alt_text?: string }
    const updated = await Media.update(parseInt(req.params.id), { alt_text })

    res.json({ media: updated })
  },

  async destroy(req: Request, res: Response) {
    const media = await Media.find(parseInt(req.params.id))
    if (!media) {
      return res.json({ error: 'Media not found' }, 404)
    }

    await Media.delete(parseInt(req.params.id))

    // The row is the record; a storage object that outlives it is a leak, but a
    // failure to remove it should not fail the request the user asked for.
    try {
      await deleteUpload(media.path, { userId: req.userId })
    } catch (err) {
      console.error('Failed to remove the stored object:', (err as Error).message)
    }

    res.json({ message: 'Media deleted' })
  },

  async stats(req: Request, res: Response) {
    const stats = await Media.getStats()
    res.json({ stats })
  }
}

/**
 * Attach a URL to each media row.
 *
 * The database stores the storage key, not a URL, so that moving buckets or
 * putting a CDN in front of one does not require rewriting every row.
 */
async function withUrls<T extends { path: string }>(items: T[]) {
  const storage = await getStorage()

  return items.map((item) => ({
    ...item,
    url: storage.publicUrl(item.path)
  }))
}
