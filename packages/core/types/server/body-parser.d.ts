/**
 * Parse request body based on content-type.
 *
 * `skip` leaves the request stream untouched, which is the only way to serve a
 * route that needs the bytes exactly as sent. Webhook signature verification is
 * the usual case: the signature is computed over the raw body, and a body that
 * has been parsed and re-stringified does not reproduce it — key order, spacing
 * and number formatting are all free to change.
 *
 * @param {Object} [options]
 * @param {string|number} [options.limit] - maximum body size
 * @param {Function|string|string[]} [options.skip] - routes to leave unparsed
 *
 * @example
 * // A webhook route reads the stream itself.
 * app.use(bodyParser({ skip: '/api/webhooks/' }))
 *
 * @example
 * app.use(bodyParser({ skip: (req) => req.headers['content-type'] === 'application/octet-stream' }))
 */
export function bodyParser(options?: {
    limit?: string | number;
    skip?: Function | string | string[];
}): (req: any, res: any, next: any) => Promise<any>;
/**
 * JSON-only body parser.
 *
 * Takes the same `skip` option as `bodyParser`, for the same reason.
 *
 * @param {Object} [options]
 * @param {string|number} [options.limit] - maximum body size
 * @param {Function|string|string[]} [options.skip] - routes to leave unparsed
 */
export function json(options?: {
    limit?: string | number;
    skip?: Function | string | string[];
}): (req: any, res: any, next: any) => Promise<any>;
