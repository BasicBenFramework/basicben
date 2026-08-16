/**
 * CBOR decoder tests.
 *
 * The vectors are RFC 8949 Appendix A — published, independent of this
 * implementation, and the reason this layer does not have to be taken on trust.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { decodeCbor, decodeCborFirst } from './cbor.js'

const hex = (s) => Buffer.from(s, 'hex')

describe('RFC 8949 Appendix A — integers', () => {
  const vectors = [
    ['00', 0],
    ['01', 1],
    ['0a', 10],
    ['17', 23],
    ['1818', 24],
    ['1819', 25],
    ['1864', 100],
    ['1903e8', 1000],
    ['1a000f4240', 1000000],
    ['20', -1],
    ['29', -10],
    ['3863', -100],
    ['3903e7', -1000]
  ]

  for (const [encoded, expected] of vectors) {
    test(`${encoded} decodes to ${expected}`, () => {
      assert.strictEqual(decodeCbor(hex(encoded)), expected)
    })
  }
})

describe('RFC 8949 Appendix A — strings and bytes', () => {
  test('empty text string', () => {
    assert.strictEqual(decodeCbor(hex('60')), '')
  })

  test('"a"', () => {
    assert.strictEqual(decodeCbor(hex('6161')), 'a')
  })

  test('"IETF"', () => {
    assert.strictEqual(decodeCbor(hex('6449455446')), 'IETF')
  })

  test('empty byte string', () => {
    assert.strictEqual(decodeCbor(hex('40')).length, 0)
  })

  test("h'01020304'", () => {
    assert.ok(decodeCbor(hex('4401020304')).equals(hex('01020304')))
  })

  test('a multi-byte UTF-8 string', () => {
    // "ü" — two bytes, so a naive length check would truncate it.
    assert.strictEqual(decodeCbor(hex('62c3bc')), 'ü')
  })
})

describe('RFC 8949 Appendix A — arrays and maps', () => {
  test('empty array', () => {
    assert.deepStrictEqual(decodeCbor(hex('80')), [])
  })

  test('[1, 2, 3]', () => {
    assert.deepStrictEqual(decodeCbor(hex('83010203')), [1, 2, 3])
  })

  test('nested arrays', () => {
    assert.deepStrictEqual(decodeCbor(hex('8301820203820405')), [1, [2, 3], [4, 5]])
  })

  test('empty map', () => {
    const map = decodeCbor(hex('a0'))
    assert.ok(map instanceof Map)
    assert.strictEqual(map.size, 0)
  })

  test('{1: 2, 3: 4} keeps integer keys as integers', () => {
    const map = decodeCbor(hex('a201020304'))

    assert.strictEqual(map.get(1), 2)
    assert.strictEqual(map.get(3), 4)
    // A plain object would have stringified these, and COSE distinguishes
    // between the integer 1 and the text "1".
    assert.strictEqual(map.get('1'), undefined)
  })

  test('{"a": 1, "b": [2, 3]}', () => {
    const map = decodeCbor(hex('a26161016162820203'))

    assert.strictEqual(map.get('a'), 1)
    assert.deepStrictEqual(map.get('b'), [2, 3])
  })

  test('simple values', () => {
    assert.strictEqual(decodeCbor(hex('f4')), false)
    assert.strictEqual(decodeCbor(hex('f5')), true)
    assert.strictEqual(decodeCbor(hex('f6')), null)
  })
})

describe('COSE-shaped input', () => {
  test('decodes negative keys, which is how a COSE key labels its parameters', () => {
    // {1: 2, 3: -7, -1: 1} — kty: EC2, alg: ES256, crv: P-256
    const map = decodeCbor(hex('a3010203262001'))

    assert.strictEqual(map.get(1), 2)
    assert.strictEqual(map.get(3), -7)
    assert.strictEqual(map.get(-1), 1)
  })
})

describe('malformed input is rejected rather than guessed at', () => {
  test('truncated byte string', () => {
    assert.throws(() => decodeCbor(hex('4401')), /runs past the end/)
  })

  test('truncated text string', () => {
    assert.throws(() => decodeCbor(hex('6449')), /runs past the end/)
  })

  test('truncated integer argument', () => {
    assert.throws(() => decodeCbor(hex('19')), /Unexpected end/)
  })

  test('empty input', () => {
    assert.throws(() => decodeCbor(hex('')), /Unexpected end/)
  })

  test('trailing data after a complete item', () => {
    assert.throws(() => decodeCbor(hex('0101')), /Trailing CBOR data/)
  })

  test('indefinite-length items are refused', () => {
    // 0x5f is an indefinite-length byte string. Legal CBOR, never sent by an
    // authenticator, and decoding it would be untested surface.
    assert.throws(() => decodeCbor(hex('5f42010243030405ff')), /Indefinite-length/)
  })

  test('a truncated map does not silently return a partial map', () => {
    assert.throws(() => decodeCbor(hex('a201')), /Unexpected end/)
  })

  test('reserved additional information', () => {
    assert.throws(() => decodeCbor(hex('1c')), /Reserved CBOR/)
  })
})

describe('decodeCborFirst', () => {
  test('reports where the item ended, ignoring what follows', () => {
    const { value, offset } = decodeCborFirst(hex('0101'))

    assert.strictEqual(value, 1)
    assert.strictEqual(offset, 1)
  })
})
