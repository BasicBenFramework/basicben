import { getDb } from '@basicbenframework/core/db'
import { exportChunks, EXPORT_FORMAT } from '../helpers/export-data.ts'
import type { Request, Response } from '../types/index.ts'

/**
 * The framework hands handlers Node's own response object, so `write` exists;
 * the shared `Response` type only names what most handlers need.
 */
type StreamingResponse = Response & {
  write: (chunk: string) => boolean
  once?: (event: 'drain', listener: () => void) => void
}

export const ExportController = {
  /**
   * `GET /api/export` — the whole site as one JSON download.
   *
   * Streamed rather than built and sent, so a site with years of posts does not
   * need its whole export in memory at once. `?revisions=1` includes revision
   * history, which is off by default because it can dwarf everything else.
   *
   * Secrets never reach this point: `exportChunks` exports an allowlist of
   * tables and drops password hashes from users and credential-looking keys
   * from settings. See `src/helpers/export-data.ts` and docs/import-export.md.
   */
  async download(req: Request, res: Response) {
    const db = await getDb()
    const revisions = req.query.revisions === '1' || req.query.revisions === 'true'
    const stamp = new Date().toISOString().slice(0, 10)
    const out = res as StreamingResponse

    out.setHeader('Content-Type', 'application/json; charset=utf-8')
    out.setHeader('Content-Disposition', `attachment; filename="${EXPORT_FORMAT}-${stamp}.json"`)
    // An export is a copy of the site's private content, drafts included.
    out.setHeader('Cache-Control', 'no-store')

    try {
      for await (const chunk of exportChunks(db, { revisions })) {
        // Respect backpressure: a slow client should slow the export, not make
        // the server buffer the rest of it.
        if (!out.write(chunk) && out.once) {
          await new Promise<void>((resolve) => out.once!('drain', resolve))
        }
      }
      out.end()
    } catch (error) {
      // Headers are gone by now, so the only honest signal left is a body that
      // is not valid JSON. The importer refuses it rather than half-importing.
      console.error('[export]', (error as Error).message)
      out.end('\n/* export failed */')
    }
  }
}
