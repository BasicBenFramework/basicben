export function serveStatic(options?: {}): (req: any, res: any, next: any) => any;
/**
 * SPA history fallback.
 *
 * Wraps a not-found handler so unmatched client routes serve index.html and the
 * browser-side router can take over. Intended for `onNoMatch`, which runs after
 * route matching — putting this in the middleware chain would shadow the API,
 * since static middleware runs before routes are matched.
 */
export function spaFallback(options: {}, next: any): (req: any, res: any) => any;
