/**
 * The members feature's settings, added to core's allowlist at boot through
 * `host.settings.define`.
 */

import { checks, type SettingDefinition } from '../../helpers/site-settings.ts'

/**
 * Who may become a member. See MemberController.
 *
 * - `open`: anyone may sign up with a magic link.
 * - `invite`: only addresses an admin added or imported may sign in.
 * - `closed`: no magic links at all. Existing sessions run until they end.
 */
export const MEMBER_SIGNUP_MODES = ['open', 'invite', 'closed'] as const

// The sign-in URL is the front-end page a magic link opens — a setting, not a
// request parameter, so a caller can never have a link (and the token in it)
// delivered to a page of their choosing.
export const MEMBER_SETTINGS: Record<string, SettingDefinition> = {
  members_signup: { group: 'members', check: checks.oneOf(MEMBER_SIGNUP_MODES) },
  members_signin_url: { group: 'members', check: checks.httpUrlOrBlank },
  newsletter_sender_name: { group: 'members', check: checks.text(100) },
  newsletter_reply_to: { group: 'members', check: checks.emailOrBlank },
  newsletter_footer: { group: 'members', check: checks.text(2000) }
}
