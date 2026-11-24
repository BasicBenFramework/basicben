import { can } from '@basicbenframework/core/auth/permissions'
import { imageSize } from '../helpers/image-size'
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
import { guardWrite, MEDIA_HOOKS } from '../helpers/write-hooks'
import type { Request, Response } from '../types'

const MAX_FILE_SIZE = 10 * 1024 * 1024

export const MediaController = {
  async index(req: Request, res: Response) {
    // Bounded: an unbounded per_page is one request that reads the whole
    // library and resolves a URL for every row.
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string) || 20))
    const search = (req.query.search as string) || undefined
    const type = (req.query.type as string) || undefined
    const { items, total } = await Media.all(page, perPage, { search, type })

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

    // Images are read back once, to record their size and to check that the
    // bytes are the image they were declared to be. The upload went straight
    // to storage, so this is the first time the server sees the file.
    let dimensions: { width: number; height: number } | null = null
    if (String(result.contentType).startsWith('image/')) {
      const storage = await getStorage()
      let info: ReturnType<typeof imageSize> = null
      try {
        const object = await storage.get(result.key as string)
        info = imageSize(new Uint8Array(object.body))
      } catch (err) {
        console.error('Could not read the uploaded image:', (err as Error).message)
      }

      if (!info || info.type !== result.contentType) {
        await storage.delete(result.key as string).catch(() => {})
        return res.json({ error: 'That file is not a valid image of the type it claims to be.' }, 422)
      }
      dimensions = { width: info.width, height: info.height }
    }

    // The file is in storage by now, so a refusal removes it: a library
    // entry that was refused should not leave an orphaned object behind.
    const creating = await guardWrite(MEDIA_HOOKS.CREATING, {
      user_id: req.userId,
      filename: result.key as string,
      original_name: filename || (result.key as string).split('/').pop() || 'file',
      path: result.key as string,
      mime_type: result.contentType,
      size: result.size,
      alt_text: altText,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null
    }, { req }, { refused: 'Upload rejected.' })

    if (!creating.ok) {
      await deleteUpload(result.key as string, { userId: req.userId }).catch(() => {})
      return res.json({ error: creating.error }, creating.status)
    }

    // The key is the object that was verified; a listener may change the
    // row's other fields, not which file it points at.
    const media = await Media.create({ ...creating.value, filename: result.key as string, path: result.key as string })

    res.json({ media: { ...media, url: result.url } }, 201)
  },

  async update(req: Request, res: Response) {
    const media = await Media.find(parseInt(req.params.id))
    if (!media) {
      return res.json({ error: 'Media not found' }, 404)
    }

    // Your own uploads, or anyone's if you may manage the library. Holding
    // `media.upload` used to be enough to rewrite another author's alt text.
    if (!can(req.user, 'media.delete', media)) {
      return res.json({ error: 'You do not have permission to edit this item.' }, 403)
    }

    const { alt_text } = req.body as { alt_text?: string }
    const updating = await guardWrite(MEDIA_HOOKS.UPDATING, { alt_text }, { req, media }, { refused: 'Update rejected.' })
    if (!updating.ok) return res.json({ error: updating.error }, updating.status)

    const updated = await Media.update(parseInt(req.params.id), { alt_text: updating.value.alt_text })

    // Through withUrls like index and show, so a caller that swaps the updated
    // row into its list does not lose the URL and blank out the thumbnail.
    const [withUrl] = await withUrls([updated])

    res.json({ media: withUrl })
  },

  async destroy(req: Request, res: Response) {
    const media = await Media.find(parseInt(req.params.id))
    if (!media) {
      return res.json({ error: 'Media not found' }, 404)
    }

    // Checked against the row, so `media.delete.own` works: an author could
    // never delete their own upload while the route demanded `media.delete`.
    if (!can(req.user, 'media.delete', media)) {
      return res.json({ error: 'You do not have permission to delete this item.' }, 403)
    }

    // A listener may refuse, say for an image a published post still uses.
    const intent = await guardWrite(MEDIA_HOOKS.DELETING, { media, cancel: false }, { req }, { refused: 'Deletion rejected.' })
    if (!intent.ok) return res.json({ error: intent.error }, intent.status)

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
