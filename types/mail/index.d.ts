/**
 * Send a message using the configured transport.
 *
 * @param {Object} message - { to, subject, text, html, from?, replyTo?, headers? }
 * @returns {Promise<Object>} whatever the transport returns
 */
export function sendMail(message: any): Promise<any>;
/**
 * Resolve the configured transport.
 *
 * @returns {Promise<{ transport: Function, from: string }>}
 */
export function getMailer(): Promise<{
    transport: Function;
    from: string;
}>;
/**
 * Forget the resolved transport. Testing only.
 */
export function resetMailer(): void;
/**
 * Build a transport from config.
 *
 * Accepts a function directly, or a named transport with its options, which is
 * friendlier in a config file that would rather not import anything.
 *
 * @param {Object} mail
 * @returns {Function}
 */
export function resolveTransport(mail?: any): Function;
/**
 * Log the message instead of sending it.
 *
 * The default, so a new project works with no mail account. It prints the body,
 * which is what makes a verification link usable in development.
 *
 * @param {Object} [options]
 * @param {Function} [options.log]
 * @returns {Function} transport
 */
export function consoleTransport(options?: {
    log?: Function;
}): Function;
/**
 * POST the message to a provider's HTTP API.
 *
 * Every modern provider offers one, so a single transport plus a `map` covers
 * Resend, Postmark, Mailgun, SES and the rest without a dependency each.
 *
 * @param {Object} options
 * @param {string} options.url
 * @param {Object} [options.headers]
 * @param {Function} [options.map] - message → request body
 * @returns {Function} transport
 */
export function httpTransport(options?: {
    url: string;
    headers?: any;
    map?: Function;
}): Function;
/**
 * Render a message without sending it. Useful for previews and tests.
 *
 * @param {Object} message
 * @returns {string}
 */
export function renderRaw(message: any): string;
export { renderMail } from "./render.js";
import { smtpTransport } from './smtp.js';
import { resendTransport } from './smtp.js';
export { smtpTransport, resendTransport };
export { buildMessage, extractAddresses, extractAddress, encodeHeader } from "./message.js";
