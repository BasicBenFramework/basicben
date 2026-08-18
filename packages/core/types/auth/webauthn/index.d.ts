/**
 * Options for `navigator.credentials.create()`.
 *
 * The challenge is returned separately so the caller can store it: it must be
 * checked server-side, and a challenge the client chooses is no challenge.
 *
 * @param {Object} options
 * @param {string} options.rpId
 * @param {string} options.rpName
 * @param {{ id: string|number, name: string, displayName?: string, handle?: string|number }} options.user
 *   `handle` is what gets stored on the authenticator, and it may be visible;
 *   pass an opaque one so the row id is not enumerable. Defaults to `id`.
 * @param {Array} [options.excludeCredentials]
 * @param {string} [options.userVerification]
 * @param {number} [options.timeout]
 * @returns {{ options: Object, challenge: string }}
 */
export function generateRegistrationOptions({ rpId, rpName, user, excludeCredentials, userVerification, timeout }?: {
    rpId: string;
    rpName: string;
    user: {
        id: string | number;
        name: string;
        displayName?: string;
        handle?: string | number;
    };
    excludeCredentials?: any[];
    userVerification?: string;
    timeout?: number;
}): {
    options: any;
    challenge: string;
};
/**
 * Options for `navigator.credentials.get()`.
 *
 * @param {Object} options
 * @returns {{ options: Object, challenge: string }}
 */
export function generateAuthenticationOptions({ rpId, allowCredentials, userVerification, timeout }?: any): {
    options: any;
    challenge: string;
};
/**
 * Verify a registration response.
 *
 * @param {Object} params
 * @param {{ id: string, response: { clientDataJSON: string, attestationObject: string } }} params.response
 * @param {string} params.expectedChallenge
 * @param {string|string[]} params.expectedOrigin
 * @param {string} params.expectedRpId
 * @param {boolean} [params.requireUserVerification]
 * @returns {{
 *   credentialId: string,
 *   publicKey: string,
 *   algorithm: number,
 *   signCount: number,
 *   aaguid: string|null,
 *   userVerified: boolean,
 *   backedUp: boolean,
 *   attestationFormat: string|null
 * }}
 */
export function verifyRegistration({ response, expectedChallenge, expectedOrigin, expectedRpId, requireUserVerification }?: {
    response: {
        id: string;
        response: {
            clientDataJSON: string;
            attestationObject: string;
        };
    };
    expectedChallenge: string;
    expectedOrigin: string | string[];
    expectedRpId: string;
    requireUserVerification?: boolean;
}): {
    credentialId: string;
    publicKey: string;
    algorithm: number;
    signCount: number;
    aaguid: string | null;
    userVerified: boolean;
    backedUp: boolean;
    attestationFormat: string | null;
};
/**
 * Verify an authentication response.
 *
 * @param {Object} params
 * @param {Object} params.response
 * @param {{ credentialId: string, publicKey: string, signCount?: number }} params.credential
 * @param {string} params.expectedChallenge
 * @param {string|string[]} params.expectedOrigin
 * @param {string} params.expectedRpId
 * @param {boolean} [params.requireUserVerification]
 * @returns {{ verified: true, signCount: number, userVerified: boolean }}
 */
export function verifyAuthentication({ response, credential, expectedChallenge, expectedOrigin, expectedRpId, requireUserVerification }?: {
    response: any;
    credential: {
        credentialId: string;
        publicKey: string;
        signCount?: number;
    };
    expectedChallenge: string;
    expectedOrigin: string | string[];
    expectedRpId: string;
    requireUserVerification?: boolean;
}): {
    verified: true;
    signCount: number;
    userVerified: boolean;
};
export { decodeCbor } from "./cbor.js";
export { parseAuthenticatorData, parseClientData, fromBase64Url, toBase64Url } from "./parse.js";
export { coseToSpki, coseToPublicKey } from "./cose.js";
