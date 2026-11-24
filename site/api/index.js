/**
 * The Vercel entry point.
 *
 * BasicBen is a long-running `node:http` server: `createApp` builds a real
 * `http.Server` and you call `listen()` on it. Vercel's model is the opposite —
 * one handler invocation per request, with no socket to bind. Bridging the two
 * is the whole job of this file.
 *
 * It works because `app.server` is a genuine `http.Server`, and that class
 * dispatches by emitting `request`. Vercel hands us Node's own `IncomingMessage`
 * and `ServerResponse`, which is exactly what the server's own listener would
 * have received, so emitting the event runs the identical middleware chain,
 * router and error handler. Nothing is re-implemented and nothing forks: local
 * development and production execute the same code by the same path.
 *
 * The import is the *built* server rather than the TypeScript source. Vite has
 * already resolved every route, controller and model into one module, so the
 * function bundle does not have to reproduce the project's build. `dist/` is
 * produced by `buildCommand` before functions are bundled.
 */

import app from '../dist/server/index.js'

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export default function handler(req, res) {
  // Synchronous: `emit` runs the listener inline and the framework's own
  // handler owns the response from here, including errors. Awaiting anything
  // would return before the response is written and cut the request off.
  app.server.emit('request', req, res)
}
