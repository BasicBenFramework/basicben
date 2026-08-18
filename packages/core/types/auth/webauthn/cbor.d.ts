/**
 * Decode one CBOR item.
 *
 * @param {Uint8Array|Buffer} input
 * @returns {*}
 * @throws when the input is malformed or uses an unsupported construct
 */
export function decodeCbor(input: Uint8Array | Buffer): any;
/**
 * Decode the first CBOR item and report where it ended.
 *
 * An attestation object is followed by the authenticator data in some formats,
 * so the caller sometimes needs the boundary.
 *
 * @param {Uint8Array|Buffer} input
 * @returns {{ value: *, offset: number }}
 */
export function decodeCborFirst(input: Uint8Array | Buffer): {
    value: any;
    offset: number;
};
