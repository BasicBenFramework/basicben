/**
 * Build an RFC 5322 message.
 *
 * @param {Object} message
 * @param {string} message.from
 * @param {string|string[]} message.to
 * @param {string} message.subject
 * @param {string} [message.text]
 * @param {string} [message.html]
 * @param {string} [message.replyTo]
 * @param {Object} [message.headers] - additional headers
 * @param {Date} [message.date]
 * @param {string} [message.messageId]
 * @returns {string} the full message, CRLF-delimited
 */
export function buildMessage(message: {
    from: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
    headers?: any;
    date?: Date;
    messageId?: string;
}): string;
/**
 * Extract the bare addresses for the SMTP envelope.
 *
 * The envelope is separate from the headers: "Ada <ada@example.com>" is a fine
 * header value but SMTP wants only what is inside the angle brackets.
 *
 * @param {string|string[]} value
 * @returns {string[]}
 */
export function extractAddresses(value: string | string[]): string[];
/**
 * Pull the address out of a possibly-decorated string.
 *
 * @param {string} value
 * @returns {string}
 */
export function extractAddress(value: string): string;
/**
 * Encode a header value.
 *
 * Headers are ASCII-only, so anything outside it goes in an RFC 2047 encoded
 * word. A display name is encoded while the address inside the brackets is left
 * alone, since the address itself must stay literal.
 *
 * @param {string} value
 * @returns {string}
 */
export function encodeHeader(value: string): string;
