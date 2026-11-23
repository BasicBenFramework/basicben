/**
 * Core's own scheduled work, registered in the same cron registry features use.
 */

import { getDb } from '@basicbenframework/core/db'
import { addCronTask } from './index.ts'
import { publishDue } from '../helpers/publish-due.ts'

addCronTask({
  name: 'publish-due',
  everySeconds: 60,
  run: async () => ({ announced: await publishDue() })
})

/**
 * What DatabaseStore.sweep does, inline: nothing else calls the store's sweep,
 * so lapsed rows would otherwise stay forever. A row whose window and block
 * have both passed is the state "never seen".
 */
addCronTask({
  name: 'rate-limit-sweep',
  everySeconds: 3600,
  run: async () => {
    const db = (await getDb()) as any
    const now = Date.now()
    const swept = await db.run(
      'DELETE FROM rate_limits WHERE updated_at < ? AND (blocked_until IS NULL OR blocked_until < ?)',
      [now - 86_400_000, now]
    )
    return { swept: Number(swept?.changes ?? 0) }
  }
})
