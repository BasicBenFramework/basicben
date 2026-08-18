/**
 * Sign a payload.
 *
 * @param {string} body - the exact bytes that will be sent
 * @param {string} secret
 * @returns {string} `sha256=<hex>`
 */
export function sign(body: string, secret: string): string;
/**
 * Verify a signature against a raw body.
 *
 * Compared with `timingSafeEqual`, so the check does not leak how much of a
 * forged signature was correct. Lengths are compared first because
 * `timingSafeEqual` throws on a mismatch rather than returning false.
 *
 * @param {string} body - the raw request body, exactly as received
 * @param {string} signature - the X-BasicBen-Signature header
 * @param {string} secret
 * @returns {boolean}
 */
export function verify(body: string, signature: string, secret: string): boolean;
/**
 * Deliver one event to every configured URL.
 *
 * Deliveries run concurrently and independently: one slow or broken receiver
 * must not delay or cancel the others. Nothing here throws — a webhook failing
 * must never fail the request that triggered it, which is a content write the
 * user already considers done.
 *
 * @param {Object} options
 * @param {string[]} options.urls
 * @param {string} options.event - e.g. 'post.created'
 * @param {Object} options.data - merged into the payload
 * @param {string} options.secret
 * @param {number} [options.timeout]
 * @param {Function} [options.fetch] - injectable for tests
 * @returns {Promise<Array<{url: string, ok: boolean, status?: number, error?: string}>>}
 */
export function deliver({ urls, event, data, secret, timeout, fetch: fetchImpl }?: {
    urls: string[];
    event: string;
    data: any;
    secret: string;
    timeout?: number;
    fetch?: Function;
}): Promise<Array<{
    url: string;
    ok: boolean;
    status?: number;
    error?: string;
}>>;
