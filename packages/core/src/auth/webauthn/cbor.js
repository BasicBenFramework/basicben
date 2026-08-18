/**
 * CBOR decoding (RFC 8949), limited to what WebAuthn uses.
 *
 * An attestation object contains maps, arrays, byte strings, text strings and
 * integers — nothing else. A general CBOR library would decode tags, bignums,
 * floats and indefinite-length streams that no authenticator sends, all of which
 * is attack surface on a security path for no benefit.
 *
 * Decoding only. Nothing here needs to produce CBOR.
 */

const MAJOR_UNSIGNED = 0
const MAJOR_NEGATIVE = 1
const MAJOR_BYTES = 2
const MAJOR_TEXT = 3
const MAJOR_ARRAY = 4
const MAJOR_MAP = 5
const MAJOR_SIMPLE = 7

/**
 * Decode one CBOR item.
 *
 * @param {Uint8Array|Buffer} input
 * @returns {*}
 * @throws when the input is malformed or uses an unsupported construct
 */
export function decodeCbor(input) {
  const { value, offset } = decodeItem(Buffer.from(input), 0)

  if (offset !== input.length) {
    throw new Error(`Trailing CBOR data: ${input.length - offset} unexpected byte(s)`)
  }

  return value
}

/**
 * Decode the first CBOR item and report where it ended.
 *
 * An attestation object is followed by the authenticator data in some formats,
 * so the caller sometimes needs the boundary.
 *
 * @param {Uint8Array|Buffer} input
 * @returns {{ value: *, offset: number }}
 */
export function decodeCborFirst(input) {
  return decodeItem(Buffer.from(input), 0)
}

function decodeItem(buf, offset) {
  if (offset >= buf.length) {
    throw new Error('Unexpected end of CBOR input')
  }

  const initial = buf[offset]
  const major = initial >> 5
  const minor = initial & 0x1f

  offset += 1

  // Indefinite-length items are legal CBOR but no authenticator emits them, so
  // rejecting is safer than guessing at a construct that is never exercised.
  if (minor === 31) {
    throw new Error('Indefinite-length CBOR items are not supported')
  }

  const { value: length, offset: next } = readLength(buf, offset, minor)
  offset = next

  switch (major) {
    case MAJOR_UNSIGNED:
      return { value: length, offset }

    case MAJOR_NEGATIVE:
      // -1 - n, which is how COSE spells its negative label keys.
      return { value: typeof length === 'bigint' ? -1n - length : -1 - length, offset }

    case MAJOR_BYTES: {
      const end = offset + Number(length)
      if (end > buf.length) throw new Error('CBOR byte string runs past the end of the input')
      return { value: buf.subarray(offset, end), offset: end }
    }

    case MAJOR_TEXT: {
      const end = offset + Number(length)
      if (end > buf.length) throw new Error('CBOR text string runs past the end of the input')
      return { value: buf.subarray(offset, end).toString('utf8'), offset: end }
    }

    case MAJOR_ARRAY: {
      const items = []
      for (let i = 0; i < Number(length); i++) {
        const item = decodeItem(buf, offset)
        items.push(item.value)
        offset = item.offset
      }
      return { value: items, offset }
    }

    case MAJOR_MAP: {
      // A Map, not an object: COSE keys are integers, and an object would
      // stringify them and lose the distinction between 1 and "1".
      const map = new Map()
      for (let i = 0; i < Number(length); i++) {
        const key = decodeItem(buf, offset)
        const value = decodeItem(buf, key.offset)
        map.set(key.value, value.value)
        offset = value.offset
      }
      return { value: map, offset }
    }

    case MAJOR_SIMPLE:
      if (minor === 20) return { value: false, offset }
      if (minor === 21) return { value: true, offset }
      if (minor === 22) return { value: null, offset }
      if (minor === 23) return { value: undefined, offset }
      throw new Error(`Unsupported CBOR simple value ${minor}`)

    default:
      throw new Error(`Unsupported CBOR major type ${major}`)
  }
}

/**
 * Read the argument encoded in the initial byte's low bits.
 */
function readLength(buf, offset, minor) {
  if (minor < 24) return { value: minor, offset }

  if (minor === 24) {
    requireBytes(buf, offset, 1)
    return { value: buf[offset], offset: offset + 1 }
  }

  if (minor === 25) {
    requireBytes(buf, offset, 2)
    return { value: buf.readUInt16BE(offset), offset: offset + 2 }
  }

  if (minor === 26) {
    requireBytes(buf, offset, 4)
    return { value: buf.readUInt32BE(offset), offset: offset + 4 }
  }

  if (minor === 27) {
    requireBytes(buf, offset, 8)
    const value = buf.readBigUInt64BE(offset)
    // Keep it a number where that is exact; a length past 2^53 is nonsense here
    // anyway, but a silently rounded one would be worse than a BigInt.
    return {
      value: value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value,
      offset: offset + 8
    }
  }

  throw new Error(`Reserved CBOR additional information ${minor}`)
}

function requireBytes(buf, offset, count) {
  if (offset + count > buf.length) {
    throw new Error('Unexpected end of CBOR input')
  }
}
