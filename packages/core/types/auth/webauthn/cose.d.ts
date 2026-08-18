/**
 * Convert a decoded COSE key to SPKI DER.
 *
 * @param {Map} cose - as produced by the CBOR decoder
 * @returns {{ spki: Buffer, algorithm: number }}
 */
export function coseToSpki(cose: Map<any, any>): {
    spki: Buffer;
    algorithm: number;
};
/**
 * Turn a COSE key into something node:crypto can verify with.
 *
 * @param {Map} cose
 * @returns {{ key: import('node:crypto').KeyObject, algorithm: number }}
 */
export function coseToPublicKey(cose: Map<any, any>): {
    key: import("node:crypto").KeyObject;
    algorithm: number;
};
export namespace KTY {
    let EC2: number;
    let RSA: number;
}
export namespace ALG {
    let ES256: number;
    let RS256: number;
}
export namespace CRV {
    let P256: number;
}
