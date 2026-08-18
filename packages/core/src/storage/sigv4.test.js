/**
 * SigV4 tests.
 *
 * The 34 cases in `aws-sigv4-suite.json` are AWS's own published test suite,
 * mirrored from botocore. They are the only thing that settles whether a
 * hand-rolled signer is correct, and they are checked stage by stage —
 * canonical request, string to sign, then signature — because a mismatch in the
 * final hex tells you nothing about where it went wrong.
 *
 * The suite signs against service `service` rather than `s3`, which is useful:
 * it exercises the path-normalizing branch. S3's non-normalizing branch is
 * covered by the tests below it and, end to end, by a real MinIO server in
 * `scripts/storage-smoke.mjs`.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHmac } from 'node:crypto'
import {
  uriEncode,
  normalizePath,
  canonicalUri,
  canonicalQuery,
  canonicalHeaders,
  canonicalRequest,
  stringToSign,
  signingKey,
  signRequest,
  presignUrl,
  amzDate,
  hashPayload,
  EMPTY_PAYLOAD_HASH,
  UNSIGNED_PAYLOAD
} from './sigv4.js'

const here = dirname(fileURLToPath(import.meta.url))
const suite = JSON.parse(readFileSync(join(here, 'aws-sigv4-suite.json'), 'utf8'))

// The credentials and clock the published suite is computed against.
const SUITE = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  timestamp: '20150830T123600Z'
}

/**
 * The suite's session token.
 *
 * `get-vanilla-with-session-token` has no `x-amz-security-token` line in its
 * `.req` but expects one in its canonical request: the token comes from the
 * credentials, and the signer is expected to add the header itself. This is the
 * value botocore's suite configuration uses.
 */
const SESSION_TOKEN = '6e86291e8372ff2a2260956d9b8aae1d763fbf315fa00fa31553b73ebf194267'

/**
 * Parse a `.req` fixture into its parts.
 *
 * The request line may contain spaces inside the path (`get-space`), so the
 * method and HTTP version are taken from the ends rather than by splitting.
 */
function parseRequest(raw) {
  const [requestLine, ...headerLines] = raw.split('\n')

  const method = requestLine.slice(0, requestLine.indexOf(' '))
  const target = requestLine.slice(method.length + 1).replace(/ HTTP\/1\.1$/, '')

  const queryAt = target.indexOf('?')
  const path = queryAt === -1 ? target : target.slice(0, queryAt)
  const query = queryAt === -1 ? '' : target.slice(queryAt + 1)

  const headers = []
  let body = ''
  let inBody = false

  for (const line of headerLines) {
    if (inBody) { body += (body ? '\n' : '') + line; continue }
    if (line === '') { inBody = true; continue }

    const colon = line.indexOf(':')
    if (colon === -1) {
      // A continuation of the previous header's value.
      if (headers.length) headers[headers.length - 1][1] += ` ${line.trim()}`
      continue
    }

    headers.push([line.slice(0, colon), line.slice(colon + 1)])
  }

  return { method, path, query, headers, body }
}

/** Headers as an object, preserving duplicates by joining them. */
function headerObject(pairs) {
  const out = {}
  for (const [name, value] of pairs) {
    const key = name.toLowerCase()
    out[key] = key in out ? `${out[key]},${String(value).trim()}` : value
  }
  return out
}

describe('AWS published test suite', () => {
  const names = Object.keys(suite)

  test('the suite is present and complete', () => {
    assert.ok(names.length >= 30, `only ${names.length} cases found`)
  })

  for (const name of names) {
    const fixture = suite[name]

    describe(name, () => {
      const parsed = parseRequest(fixture.req)
      const headers = headerObject(parsed.headers)
      const payloadHash = hashPayload(parsed.body)

      // Cases whose credentials carry a session token expect the signer to
      // contribute the header rather than read it off the request.
      if (name.includes('with-session-token')) {
        headers['x-amz-security-token'] = SESSION_TOKEN
      }

      const built = canonicalRequest({
        method: parsed.method,
        path: parsed.path,
        query: parsed.query,
        headers,
        payloadHash,
        service: SUITE.service
      })

      test('canonical request', () => {
        assert.equal(built.canonical, fixture.creq)
      })

      test('string to sign', () => {
        const toSign = stringToSign({
          canonical: built.canonical,
          timestamp: SUITE.timestamp,
          region: SUITE.region,
          service: SUITE.service
        })

        assert.equal(toSign, fixture.sts)
      })

      test('signature', () => {
        const toSign = stringToSign({
          canonical: built.canonical,
          timestamp: SUITE.timestamp,
          region: SUITE.region,
          service: SUITE.service
        })

        const key = signingKey({
          secretAccessKey: SUITE.secretAccessKey,
          date: SUITE.timestamp.slice(0, 8),
          region: SUITE.region,
          service: SUITE.service
        })

        const signature = createHmac('sha256', key).update(toSign).digest('hex')
        const expected = /Signature=([0-9a-f]+)/.exec(fixture.authz)[1]

        assert.equal(signature, expected)
      })

      test('signed headers match the published Authorization header', () => {
        const expected = /SignedHeaders=([^,]+)/.exec(fixture.authz)[1]
        assert.equal(built.signedHeaders, expected)
      })
    })
  }
})

describe('uriEncode', () => {
  test('leaves unreserved characters alone', () => {
    const unreserved = 'ABCXYZabcxyz0189-_.~'
    assert.equal(uriEncode(unreserved), unreserved)
  })

  test('encodes what encodeURIComponent would not', () => {
    // These are the characters that make encodeURIComponent the wrong tool.
    assert.equal(uriEncode("!'()*"), '%21%27%28%29%2A')
  })

  test('encodes spaces as %20, never as +', () => {
    assert.equal(uriEncode('a b'), 'a%20b')
  })

  test('encodes UTF-8 byte by byte', () => {
    assert.equal(uriEncode('ሴ'), '%E1%88%B4')
    assert.equal(uriEncode('é'), '%C3%A9')
  })

  test('conditionally preserves the slash', () => {
    assert.equal(uriEncode('a/b', true), 'a%2Fb')
    assert.equal(uriEncode('a/b', false), 'a/b')
  })
})

describe('normalizePath', () => {
  test('resolves dot segments and collapses slashes', () => {
    assert.equal(normalizePath('/./'), '/')
    assert.equal(normalizePath('//'), '/')
    assert.equal(normalizePath('//example//'), '/example/')
    assert.equal(normalizePath('/example/..'), '/')
    assert.equal(normalizePath('/example1/example2/../..'), '/')
    assert.equal(normalizePath('/./example'), '/example')
  })
})

describe('S3 path handling', () => {
  test('S3 does not normalize, other services do', () => {
    // The divergence that produces signatures S3 rejects when missed: an object
    // key may legitimately contain ".." and rewriting it signs a different key.
    assert.equal(canonicalUri('/bucket/a/../b.txt', 's3'), '/bucket/a/../b.txt')
    assert.equal(canonicalUri('/bucket/a/../b.txt', 'service'), '/bucket/b.txt')
  })

  test('keys with dots and doubled slashes survive for S3', () => {
    assert.equal(canonicalUri('/media/./x.png', 's3'), '/media/./x.png')
    assert.equal(canonicalUri('/media//x.png', 's3'), '/media//x.png')
  })

  test('slashes are preserved but other characters encoded', () => {
    assert.equal(canonicalUri('/a b/c$d.png', 's3'), '/a%20b/c%24d.png')
  })

  test('an empty path signs as /', () => {
    assert.equal(canonicalUri('', 's3'), '/')
  })
})

describe('canonicalQuery', () => {
  test('sorts by the encoded key, not the decoded one', () => {
    // Decoded, "ሴ" sorts last; encoded, "%E1%88%B4" sorts first.
    assert.equal(
      canonicalQuery('Param-3=Value3&Param=Value2&%E1%88%B4=Value1'),
      '%E1%88%B4=Value1&Param=Value2&Param-3=Value3'
    )
  })

  test('sorts duplicate keys by value', () => {
    assert.equal(canonicalQuery('Param1=value2&Param1=Value1'), 'Param1=Value1&Param1=value2')
  })

  test('a key with no value still gets an equals sign', () => {
    assert.equal(canonicalQuery('a'), 'a=')
  })

  test('empty query is an empty string', () => {
    assert.equal(canonicalQuery(''), '')
    assert.equal(canonicalQuery(undefined), '')
  })
})

describe('canonicalHeaders', () => {
  test('lowercases, trims and sorts', () => {
    const { canonical, signed } = canonicalHeaders({ 'X-B': ' 2 ', 'x-a': '1' })
    assert.equal(canonical, 'x-a:1\nx-b:2\n')
    assert.equal(signed, 'x-a;x-b')
  })

  test('collapses internal whitespace', () => {
    // Servers normalize the same way; not doing it is an invisible mismatch.
    const { canonical } = canonicalHeaders({ h: '"a   b   c"' })
    assert.equal(canonical, 'h:"a b c"\n')
  })

  test('skips null and undefined values', () => {
    const { signed } = canonicalHeaders({ a: '1', b: undefined, c: null })
    assert.equal(signed, 'a')
  })
})

describe('signRequest', () => {
  const credentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  }

  test('produces a complete Authorization header', () => {
    const result = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      timestamp: '20130524T000000Z',
      ...credentials
    })

    assert.match(result.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/)
  })

  test('signs host, date and content hash', () => {
    const result = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      timestamp: '20130524T000000Z',
      ...credentials
    })

    assert.ok(result.signedHeaders.includes('host'))
    assert.ok(result.signedHeaders.includes('x-amz-date'))
    assert.ok(result.signedHeaders.includes('x-amz-content-sha256'))
  })

  test('the host header carries a non-default port', () => {
    // MinIO and other self-hosted endpoints run on a port, and signing the
    // bare hostname produces a mismatch the error message does not explain.
    const result = signRequest({
      method: 'GET',
      url: 'http://localhost:9000/bucket/key',
      timestamp: '20130524T000000Z',
      ...credentials
    })

    assert.equal(result.headers.host, 'localhost:9000')
  })

  test('a session token is signed when present', () => {
    const result = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      sessionToken: 'TOKEN',
      timestamp: '20130524T000000Z',
      ...credentials
    })

    assert.ok(result.signedHeaders.includes('x-amz-security-token'))
  })

  test('changing anything changes the signature', () => {
    const base = { method: 'GET', url: 'https://b.s3.amazonaws.com/k', timestamp: '20130524T000000Z', ...credentials }
    const original = signRequest(base).signature

    assert.notEqual(signRequest({ ...base, method: 'PUT' }).signature, original)
    assert.notEqual(signRequest({ ...base, url: 'https://b.s3.amazonaws.com/other' }).signature, original)
    assert.notEqual(signRequest({ ...base, timestamp: '20130524T000001Z' }).signature, original)
    assert.notEqual(signRequest({ ...base, region: 'eu-west-1' }).signature, original)
    assert.notEqual(signRequest({ ...base, secretAccessKey: 'other' }).signature, original)
  })
})

describe('presignUrl', () => {
  const credentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  }

  test('carries every parameter S3 requires', () => {
    const url = new URL(presignUrl({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      expiresIn: 86400,
      timestamp: '20130524T000000Z',
      ...credentials
    }))

    assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
    assert.equal(url.searchParams.get('X-Amz-Date'), '20130524T000000Z')
    assert.equal(url.searchParams.get('X-Amz-Expires'), '86400')
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host')
    assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/)
    assert.equal(
      url.searchParams.get('X-Amz-Credential'),
      'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request'
    )
  })

  test('the signature covers the method', () => {
    // A URL presigned for GET must not also work for PUT, or a read link
    // becomes a write link.
    const base = { url: 'https://b.s3.amazonaws.com/k', timestamp: '20130524T000000Z', ...credentials }
    const get = new URL(presignUrl({ ...base, method: 'GET' })).searchParams.get('X-Amz-Signature')
    const put = new URL(presignUrl({ ...base, method: 'PUT' })).searchParams.get('X-Amz-Signature')

    assert.notEqual(get, put)
  })

  test('extra headers become signed headers', () => {
    const url = new URL(presignUrl({
      method: 'PUT',
      url: 'https://b.s3.amazonaws.com/k',
      headers: { 'content-type': 'image/png' },
      timestamp: '20130524T000000Z',
      ...credentials
    }))

    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host')
  })

  test('the default payload hash is UNSIGNED-PAYLOAD', () => {
    // Without it a presigned upload is impossible: the signer would have to see
    // the bytes to hash them, which is the thing this design avoids.
    assert.equal(UNSIGNED_PAYLOAD, 'UNSIGNED-PAYLOAD')
  })

  test('rejects an expiry S3 would refuse', () => {
    const base = { method: 'GET', url: 'https://b.s3.amazonaws.com/k', ...credentials }

    assert.throws(() => presignUrl({ ...base, expiresIn: 0 }), /between/)
    assert.throws(() => presignUrl({ ...base, expiresIn: 604801 }), /between/)
    assert.doesNotThrow(() => presignUrl({ ...base, expiresIn: 604800 }))
  })

  test('a key with characters needing encoding survives', () => {
    const url = presignUrl({
      method: 'GET',
      url: 'https://b.s3.amazonaws.com/' + encodeURIComponent('a b/c.png'),
      timestamp: '20130524T000000Z',
      ...credentials
    })

    assert.ok(url.includes('X-Amz-Signature='))
  })
})

describe('helpers', () => {
  test('amzDate formats as AWS expects', () => {
    assert.equal(amzDate(new Date('2015-08-30T12:36:00Z')), '20150830T123600Z')
  })

  test('the empty payload hash is the SHA-256 of nothing', () => {
    assert.equal(EMPTY_PAYLOAD_HASH, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    assert.equal(hashPayload(''), EMPTY_PAYLOAD_HASH)
    assert.equal(hashPayload(undefined), EMPTY_PAYLOAD_HASH)
  })

  test('signingKey is scoped to date, region and service', () => {
    const base = { secretAccessKey: 'secret', date: '20150830', region: 'us-east-1', service: 's3' }
    const key = signingKey(base).toString('hex')

    assert.notEqual(signingKey({ ...base, date: '20150831' }).toString('hex'), key)
    assert.notEqual(signingKey({ ...base, region: 'eu-west-1' }).toString('hex'), key)
    assert.notEqual(signingKey({ ...base, service: 'ec2' }).toString('hex'), key)
  })
})
