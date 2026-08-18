/**
 * Application hooks.
 *
 * This is where you extend the framework's behaviour. It is imported once by
 * `src/server/index.ts`, so every listener below is registered before the
 * server starts handling requests.
 *
 * There used to be a plugin system wrapping this — an object with a name, a
 * version and an activation switch. It was removed: a plugin could not be
 * installed at runtime on any host worth deploying to, so it amounted to a
 * container around exactly the calls below, and `import` already does that job.
 *
 * ## Two kinds of hook
 *
 * A **filter** transforms a value and must return it. Returning nothing
 * replaces the value with undefined, which is the mistake to watch for.
 *
 * A **notification** is told something happened and its return value is
 * ignored. Throwing from one is contained: the error is logged with the
 * listener's name and the other listeners still run.
 */

import { hooks, HOOKS } from '@basicbenframework/core/hooks'

/**
 * Trim titles before a post is written.
 *
 * `post.creating` runs before the insert, so what it returns is what gets
 * stored. Return `{ cancel: true, reason }` instead to refuse the write.
 */
hooks.on(HOOKS.POST_CREATING, async (data: { title?: string }) => ({
  ...data,
  title: data.title?.trim()
}))

/**
 * Add a nav item to the admin sidebar.
 *
 * This fires on the server, not in the browser: the admin asks the API what to
 * render, because the hook registry lives in the server process. Firing it
 * client-side would consult a registry nothing has registered with.
 */
hooks.on(HOOKS.ADMIN_MENU, async (items: Array<{ path: string; label: string }>) => items)

/**
 * A notification. Useful for search indexing, cache purging, webhooks — work
 * that should not hold up the response any longer than it has to.
 */
hooks.on(HOOKS.POST_CREATED, async ({ post }: { post: { id: number; title: string } }) => {
  console.log(`[hooks] post created: ${post.title}`)
})
