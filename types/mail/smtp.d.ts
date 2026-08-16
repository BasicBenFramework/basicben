/**
 * Create an SMTP transport.
 *
 * @param {Object} options
 * @param {string} options.host
 * @param {number} [options.port] - defaults to 465 when secure, else 587
 * @param {boolean} [options.secure] - implicit TLS; inferred from port 465
 * @param {string} [options.user]
 * @param {string} [options.pass]
 * @param {boolean|'required'} [options.requireTls] - default 'required' when
 *   credentials are supplied, false otherwise
 * @param {number} [options.timeout] - socket timeout in ms
 * @param {string} [options.name] - hostname sent in EHLO
 * @param {Object} [options.tls] - extra options for node:tls
 * @returns {(message: Object) => Promise<{ messageId: string, accepted: string[] }>}
 */
export function smtpTransport(options?: {
    host: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    requireTls?: boolean | "required";
    timeout?: number;
    name?: string;
    tls?: any;
}): (message: any) => Promise<{
    messageId: string;
    accepted: string[];
}>;
/**
 * Resend's SMTP relay.
 *
 * The username is literally "resend" and the password is the API key — the
 * same key the HTTP API uses.
 *
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {number} [options.port] - 465 implicit TLS (default), or 587 STARTTLS
 * @returns {Function} transport
 */
export function resendTransport(options?: {
    apiKey: string;
    port?: number;
}): Function;
