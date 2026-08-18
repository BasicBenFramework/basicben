/**
 * A strong ETag for a body you already have in memory.
 *
 * Strong because it is a hash of the exact bytes: two responses with this tag
 * are byte-identical, which is what lets a range request use it.
 *
 * @param {string|Buffer} body
 * @returns {string} quoted entity-tag
 */
export function strongEtag(body: string | Buffer): string;
/**
 * A weak ETag for a file, from its size and modification time.
 *
 * Weak because it does not read the file: two files with the same size and
 * mtime are treated as the same entity, which is right for caching and wrong
 * for byte ranges. Hashing every static file on every request would be the
 * alternative, and it is not worth it.
 *
 * @param {{ size: number, mtime: Date }} stat
 * @returns {string} quoted entity-tag, W/ prefixed
 */
export function weakEtag(stat: {
    size: number;
    mtime: Date;
}): string;
/**
 * Whether the client's cached copy is still good.
 *
 * `If-None-Match` wins outright when present — an entity tag is a better
 * validator than a timestamp with one-second resolution, and RFC 9110 says to
 * ignore `If-Modified-Since` when both are sent.
 *
 * @param {Object} req - incoming request
 * @param {Object} validators
 * @param {string} [validators.etag]
 * @param {Date} [validators.lastModified]
 * @returns {boolean}
 */
export function isFresh(req: any, { etag, lastModified }?: {
    etag?: string;
    lastModified?: Date;
}): boolean;
/**
 * Set validators and answer a conditional request if the copy is fresh.
 *
 * Returns true when it has already ended the response with a 304, so the caller
 * knows not to send a body.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Object} validators
 * @param {string} [validators.etag]
 * @param {Date} [validators.lastModified]
 * @param {string} [validators.cacheControl]
 * @returns {boolean} whether a 304 was sent
 */
export function conditional(req: any, res: any, { etag, lastModified, cacheControl }?: {
    etag?: string;
    lastModified?: Date;
    cacheControl?: string;
}): boolean;
/**
 * Parse a Range header against a known entity size.
 *
 * Returns null when there is nothing to do (absent or unsupported), and
 * `{ unsatisfiable: true }` when the request names a range outside the entity,
 * which is a 416 rather than a 200.
 *
 * Multiple ranges in one request are deliberately not supported: answering them
 * means multipart/byteranges, which no media player needs and every one of them
 * copes without. A multi-range request gets the whole entity.
 *
 * @param {string|undefined} header
 * @param {number} size
 * @returns {{ start: number, end: number }|{ unsatisfiable: true }|null}
 */
export function parseRange(header: string | undefined, size: number): {
    start: number;
    end: number;
} | {
    unsatisfiable: true;
} | null;
