import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The editor's side of the post edit lock (see src/models/PostLock.ts).
 *
 * While the editor is open it holds the lock and refreshes it on a heartbeat;
 * on leaving it lets go. If someone else holds it, the editor is told who, and
 * may take over. If the lock is lost mid-edit — someone else took over — the
 * next heartbeat says so, and the editor stops offering to save.
 *
 * Raw `fetch` rather than the `api` helper, because the useful part of a 409
 * here is its body (who holds the lock), and the helper keeps only the message.
 */

export interface LockInfo {
  locked: boolean
  mine: boolean
  user_id: number | null
  user_name: string | null
  locked_at: string | null
  expires_at: string | null
  heartbeat_ms: number
  ttl_ms: number
}

export type LockStatus = 'idle' | 'pending' | 'held' | 'blocked' | 'free' | 'error'

const DEFAULT_HEARTBEAT = 30_000

function headers(): Record<string, string> {
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function call(path: string, method: string, body?: unknown): Promise<{ status: number; lock: LockInfo | null }> {
  try {
    const res = await fetch(path, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, lock: (data?.lock as LockInfo) ?? null }
  } catch {
    return { status: 0, lock: null }
  }
}

export function usePostLock(postId: number | null, enabled: boolean) {
  const [status, setStatus] = useState<LockStatus>(enabled && postId ? 'pending' : 'idle')
  const [holder, setHolder] = useState<string | null>(null)
  // Set when we had the lock and someone took it, so the banner can say that
  // rather than "is editing", which would read as if we never had it.
  const [lostIt, setLostIt] = useState(false)
  const statusRef = useRef<LockStatus>(status)
  statusRef.current = status
  const heartbeat = useRef(DEFAULT_HEARTBEAT)

  const path = postId ? `/api/posts/${postId}/lock` : ''

  const apply = useCallback((code: number, lock: LockInfo | null) => {
    if (lock?.heartbeat_ms) heartbeat.current = lock.heartbeat_ms

    if (code === 200 && lock?.mine) {
      setStatus('held')
      setHolder(null)
      setLostIt(false)
    } else if (code === 409 && lock) {
      if (statusRef.current === 'held') setLostIt(true)
      setStatus('blocked')
      setHolder(lock.user_name || 'Someone else')
    } else if (code === 0 || code >= 500) {
      // A dropped request is not a lost lock: keep whatever we had and try
      // again on the next beat. The lock outlives four missed beats.
      if (statusRef.current === 'pending') setStatus('error')
    } else {
      setStatus('error')
    }
  }, [])

  const acquire = useCallback(async (takeOver = false) => {
    if (!path) return
    const { status: code, lock } = await call(path, 'POST', takeOver ? { take_over: true } : {})
    apply(code, lock)
  }, [path, apply])

  // Take it on open, keep it while open. While blocked, keep looking: when
  // the other editor leaves, say so — but do not grab it silently, because the
  // text on screen is from before their save and has to be reloaded first.
  useEffect(() => {
    if (!enabled || !path) return
    void acquire()

    const timer = setInterval(async () => {
      if (statusRef.current === 'held' || statusRef.current === 'error') {
        await acquire()
      } else if (statusRef.current === 'blocked') {
        const { status: code, lock } = await call(path, 'GET')
        if (code === 200 && lock && (!lock.locked || lock.mine)) setStatus('free')
        else if (code === 200 && lock?.user_name) setHolder(lock.user_name)
      }
    }, heartbeat.current)

    // Let go on the way out. `keepalive` lets the request outlive the page,
    // which a beacon would too — but a beacon cannot send the Authorization
    // header, and this API has no cookie to fall back on.
    const release = () => {
      if (statusRef.current !== 'held') return
      try {
        void fetch(path, { method: 'DELETE', headers: headers(), keepalive: true })
      } catch {
        // Nothing to do on the way out; the lock expires on its own.
      }
    }

    window.addEventListener('pagehide', release)

    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', release)
      release()
    }
  }, [enabled, path, acquire])

  return {
    status,
    holder,
    lostIt,
    /** Whether this editor may save — true when the lock is ours, or there is no lock to have. */
    canSave: !enabled || status === 'held' || status === 'idle' || status === 'error',
    takeOver: () => acquire(true),
    /** Try again without taking over — after a reload, or after a save was refused. */
    retry: () => acquire(false)
  }
}
