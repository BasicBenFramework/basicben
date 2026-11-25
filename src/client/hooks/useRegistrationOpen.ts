import { useSite } from './useSite.ts'

/**
 * Whether new accounts may register, for hiding the sign-up links.
 *
 * Two switches close registration: DISABLE_REGISTRATION at build time (which
 * also drops the /register route), and the Registration setting, which can
 * change without a rebuild and so is asked of the server (`GET /api/site`,
 * through useSite). Either one closes it. The server refuses a registration on
 * its own either way; this only keeps the app from offering a door that is
 * shut.
 */
export function useRegistrationOpen(): boolean {
  const site = useSite()
  if (__DISABLE_REGISTRATION__) return false
  return site?.registration_open !== false
}
