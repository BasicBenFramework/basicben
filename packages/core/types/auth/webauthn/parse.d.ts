/**
 * Parse authenticatorData.
 *
 * Layout: rpIdHash(32) ‖ flags(1) ‖ signCount(4) ‖ [attestedCredentialData] ‖
 * [extensions].
 *
 * @param {Uint8Array|Buffer} input
 * @returns {Object}
 */
export function parseAuthenticatorData(input: Uint8Array | Buffer): any;
/**
 * Parse and sanity-check clientDataJSON.
 *
 * @param {Uint8Array|Buffer} input
 * @returns {{ type: string, challenge: string, origin: string, crossOrigin?: boolean }}
 */
export function parseClientData(input: Uint8Array | Buffer): {
    type: string;
    challenge: string;
    origin: string;
    crossOrigin?: boolean;
};
/**
 * Decode base64url, tolerating standard base64 too.
 *
 * @param {string} value
 * @returns {Buffer}
 */
export function fromBase64Url(value: string): Buffer;
/**
 * Encode as base64url without padding, which is what WebAuthn uses throughout.
 *
 * @param {Uint8Array|Buffer} value
 * @returns {string}
 */
export function toBase64Url(value: Uint8Array | Buffer): string;
export namespace FLAGS {
    let USER_PRESENT: number;
    let USER_VERIFIED: number;
    let BACKUP_ELIGIBLE: number;
    let BACKED_UP: number;
    let ATTESTED_CREDENTIAL_DATA: number;
    let EXTENSION_DATA: number;
}
