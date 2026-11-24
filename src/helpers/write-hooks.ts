/**
 * The `*.creating` / `*.updating` / `*.deleting` filters, run so a listener
 * can reliably refuse a write.
 *
 * A listener refuses by returning `{ ...value, cancel: true, reason }` (and
 * `status: 403` when the refusal is about permission), or by throwing. Before
 * framework 0.7.0 a throw was logged and the write went ahead, which made a
 * guard that crashed indistinguishable from one that approved. The filters
 * here run `strict`, so a throw stops the chain and the write is refused.
 *
 * What a throw says is shown to the caller when the write is an admin's own
 * (an extension refusing with `throw new Error('Posts need a category')` is
 * the point), and never on public writes such as comments, where it could be
 * an internal error message.
 */

import { hooks } from '@basicbenframework/core/hooks'

/** Media's write filters. The framework declares only `media.uploading`, which runs inside its storage layer. */
export const MEDIA_HOOKS = {
  CREATING: 'media.creating',
  UPDATING: 'media.updating',
  DELETING: 'media.deleting'
} as const

export type GuardedWrite<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: 403 | 422 }

export async function guardWrite<T>(
  hook: string,
  value: T,
  context: Record<string, unknown>,
  { refused, showErrors = true }: { refused: string; showErrors?: boolean }
): Promise<GuardedWrite<T>> {
  let result: any

  try {
    result = await hooks.filter(hook, value, context, { strict: true })
  } catch (err) {
    console.error(`[hooks] ${hook}: a listener threw, so the write was refused:`, err)
    const message = showErrors && err instanceof Error && err.message ? err.message.slice(0, 300) : refused
    return { ok: false, error: message, status: 422 }
  }

  if (result?.cancel) {
    return { ok: false, error: String(result.reason || refused), status: result.status === 403 ? 403 : 422 }
  }

  return { ok: true, value: result as T }
}
