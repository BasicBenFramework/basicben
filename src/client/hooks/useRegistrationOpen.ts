import { useEffect, useState } from 'react'

/**
 * Whether new accounts may register, for hiding the sign-up links.
 *
 * Two switches close registration: DISABLE_REGISTRATION at build time (which
 * also drops the /register route), and the Registration setting, which can
 * change without a rebuild and so is asked of the server (`GET /api/site`).
 * Either one closes it. The server refuses a registration on its own either
 * way; this only keeps the admin from offering a door that is shut.
 *
 * Asked once per page load and shared by every caller.
 */
let pending: Promise<boolean> | null = null

function fetchOpen(): Promise<boolean> {
  pending ??= fetch('/api/site', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => body?.registration_open !== false)
    .catch(() => true)
  return pending
}

export function useRegistrationOpen(): boolean {
  const [open, setOpen] = useState(!__DISABLE_REGISTRATION__)

  useEffect(() => {
    if (__DISABLE_REGISTRATION__) return
    let live = true
    fetchOpen().then((value) => live && setOpen(value))
    return () => { live = false }
  }, [])

  return open
}
