/**
 * Percent-encode per RFC 3986.
 *
 * `encodeURIComponent` is close but not the same: it leaves `!'()*` alone,
 * which AWS expects encoded, and it will not conditionally preserve `/`.
 *
 * @param {string} value
 * @param {boolean} [encodeSlash] - false when encoding a path
 * @returns {string}
 */
export function uriEncode(value: string, encodeSlash?: boolean): string;
/**
 * Resolve `.` and `..` and collapse repeated slashes.
 *
 * Not applied for S3 — see the note at the top of this file.
 *
 * @param {string} path
 * @returns {string}
 */
export function normalizePath(path: string): string;
/**
 * Build the canonical URI.
 *
 * @param {string} path
 * @param {string} service
 * @returns {string}
 */
export function canonicalUri(path: string, service: string): string;
/**
 * Build the canonical query string.
 *
 * Sorted by the **encoded** key and then the encoded value, which is not the
 * same order as sorting the decoded ones — `%E1%88%B4` sorts before `Param`
 * encoded, and after it decoded.
 *
 * @param {string|URLSearchParams} query
 * @returns {string}
 */
export function canonicalQuery(query: string | URLSearchParams): string;
/**
 * Canonicalize headers.
 *
 * Values are trimmed and their internal whitespace collapsed, so a header sent
 * as `"a   b"` signs as `"a b"` — servers normalize the same way, and not doing
 * it produces a signature mismatch that is invisible in the request.
 *
 * @param {Object} headers
 * @returns {{ canonical: string, signed: string }}
 */
export function canonicalHeaders(headers: any): {
    canonical: string;
    signed: string;
};
/**
 * Build the canonical request — the first of the algorithm's three stages.
 *
 * @param {Object} options
 * @returns {{ canonical: string, signedHeaders: string }}
 */
export function canonicalRequest({ method, path, query, headers, payloadHash, service }: any): {
    canonical: string;
    signedHeaders: string;
};
/**
 * Build the string to sign — the second stage.
 *
 * @param {Object} options
 * @returns {string}
 */
export function stringToSign({ canonical, timestamp, region, service }: any): string;
/**
 * Derive the signing key — the third stage.
 *
 * Four chained HMACs, each keyed by the previous result. The chain is what
 * scopes a key to one day, one region and one service, so a leaked signature
 * cannot be replayed against another.
 *
 * @param {Object} options
 * @returns {Buffer}
 */
export function signingKey({ secretAccessKey, date, region, service }: any): Buffer;
/**
 * Format a Date as the compact ISO form AWS expects.
 *
 * @param {Date} [date]
 * @returns {string} e.g. 20150830T123600Z
 */
export function amzDate(date?: Date): string;
/**
 * Sign a request, returning the headers to send with it.
 *
 * @param {Object} options
 * @param {string} options.method
 * @param {string} options.url
 * @param {string} options.region
 * @param {string} [options.service]
 * @param {string} options.accessKeyId
 * @param {string} options.secretAccessKey
 * @param {string} [options.sessionToken]
 * @param {Object} [options.headers]
 * @param {string} [options.payloadHash]
 * @param {string} [options.timestamp]
 * @returns {{ headers: Object, authorization: string, signature: string, canonical: string, stringToSign: string }}
 */
export function signRequest({ method, url, region, service, accessKeyId, secretAccessKey, sessionToken, headers, payloadHash, timestamp }: {
    method: string;
    url: string;
    region: string;
    service?: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    headers?: any;
    payloadHash?: string;
    timestamp?: string;
}): {
    headers: any;
    authorization: string;
    signature: string;
    canonical: string;
    stringToSign: string;
};
/**
 * Build a presigned URL.
 *
 * Everything the signature covers moves into the query string, so the URL can
 * be handed to a browser and used with no credentials and no further headers.
 * That is what lets a file go straight from the browser to the bucket without
 * passing through this server.
 *
 * @param {Object} options
 * @param {string} options.method - the method the holder will use, and only that one
 * @param {string} options.url
 * @param {string} options.region
 * @param {string} [options.service]
 * @param {string} options.accessKeyId
 * @param {string} options.secretAccessKey
 * @param {string} [options.sessionToken]
 * @param {number} [options.expiresIn] - seconds, max 604800 (7 days)
 * @param {Object} [options.headers] - extra headers the holder must send
 * @param {string} [options.payloadHash]
 * @param {string} [options.timestamp]
 * @returns {string}
 */
export function presignUrl({ method, url, region, service, accessKeyId, secretAccessKey, sessionToken, expiresIn, headers, payloadHash, timestamp }: {
    method: string;
    url: string;
    region: string;
    service?: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiresIn?: number;
    headers?: any;
    payloadHash?: string;
    timestamp?: string;
}): string;
/**
 * Hash a request body.
 *
 * @param {string|Buffer|Uint8Array} body
 * @returns {string}
 */
export function hashPayload(body: string | Buffer | Uint8Array): string;
/** The hash of an empty body, which appears in most GET signatures. */
export const EMPTY_PAYLOAD_HASH: string;
/** Tells S3 to sign everything except the body. */
export const UNSIGNED_PAYLOAD: "UNSIGNED-PAYLOAD";
