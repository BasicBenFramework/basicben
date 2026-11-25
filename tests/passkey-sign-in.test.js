/**
 * Signing in with a passkey instead of a password, end to end against a
 * scratch database, with a virtual authenticator signing for real.
 *
 * The passkey replaces the password and the second step together, so the
 * refusals matter more than the success: a spent challenge, a passkey that did
 * not verify the person, one nobody enrolled, and a disabled account.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

const scratch = mkdtempSync(join(tmpdir(), 'basicben-passkey-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'passkey-test-key-that-is-long-enough-to-sign-with'
process.env.APP_URL = 'https://cms.example'
delete process.env.WEBAUTHN_RP_ID
delete process.env.WEBAUTHN_ORIGINS

const b64 = (buf) => Buffer.from(buf).toString('base64url')

// Just enough CBOR for a COSE key and a "none" attestation.
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n])
  const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b
}
function cbor(v) {
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v])
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)])
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -v - 1)
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])])
  throw new Error('cbor')
}

function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const id = randomBytes(32)
  const jwk = publicKey.export({ format: 'jwk' })
  const rpIdHash = createHash('sha256').update('cms.example').digest()
  let count = 0
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin: 'https://cms.example', crossOrigin: false }))
  const flagsAndCount = (flags) => { const b = Buffer.alloc(5); b[0] = flags; b.writeUInt32BE(count, 1); return b }

  return {
    register(challenge) {
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length)
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]))
      const authData = Buffer.concat([rpIdHash, flagsAndCount(0x45), randomBytes(16), len, id, cose])
      return {
        id: b64(id), rawId: b64(id), type: 'public-key',
        response: {
          clientDataJSON: b64(clientData('webauthn.create', challenge)),
          attestationObject: b64(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])))
        }
      }
    },
    /** 0x05 is user present and verified; 0x01 is present only. */
    sign(challenge, { flags = 0x05 } = {}) {
      count++
      const data = clientData('webauthn.get', challenge)
      const authData = Buffer.concat([rpIdHash, flagsAndCount(flags)])
      const signature = createSign('SHA256').update(Buffer.concat([authData, createHash('sha256').update(data).digest()])).sign(privateKey)
      return {
        id: b64(id), rawId: b64(id), type: 'public-key',
        response: { clientDataJSON: b64(data), authenticatorData: b64(authData), signature: b64(signature) }
      }
    }
  }
}

function response() {
  return { status: 200, json(data, status = 200) { this.body = data; this.status = status } }
}

let db, PasskeyController, Credential
const call = async (handler, body = {}) => {
  const res = response()
  await PasskeyController[handler]({ method: 'POST', body, params: {}, query: {}, headers: {} }, res)
  return res
}

async function enrol(name) {
  const user = await db.run('INSERT INTO users (name, email, password, role, email_verified, slug) VALUES (?, ?, ?, ?, 1, ?)',
    [name, `${name.toLowerCase()}@example.test`, 'x', 'admin', name.toLowerCase()])
  const userId = Number(user.lastInsertRowid)
  const device = authenticator()
  const { verifyRegistration } = await import('@basicbenframework/core/auth/webauthn')
  const challenge = b64(randomBytes(32))
  const result = verifyRegistration({ response: device.register(challenge), expectedChallenge: challenge, expectedOrigin: ['https://cms.example'], expectedRpId: 'cms.example' })
  await Credential.create({ user_id: userId, credential_id: result.credentialId, public_key: result.publicKey, algorithm: result.algorithm, sign_count: 0, backed_up: 0, label: 'Test' })
  return { userId, device }
}

/** The whole ceremony: options, the authenticator's answer, the exchange. */
async function signIn(device, options) {
  const start = await call('signInOptions')
  const res = await call('signIn', { challengeHandle: start.body.challengeHandle, response: device.sign(start.body.options.challenge, options) })
  return { start, res }
}

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()
  ;({ PasskeyController } = await load('src/controllers/PasskeyController.ts'))
  ;({ Credential } = await load('src/models/Credential.ts'))
})

after(() => rmSync(scratch, { recursive: true, force: true }))

describe('signing in with a passkey alone', () => {
  test('the options name no account and ask the authenticator to verify the person', async () => {
    const { body } = await call('signInOptions')
    assert.deepEqual(body.options.allowCredentials, [])
    assert.equal(body.options.userVerification, 'required')
    assert.equal(body.options.rpId, 'cms.example')
    assert.ok(body.challengeHandle && body.challengeHandle !== body.options.challenge, 'the handle is not the challenge')
  })

  test('a verified passkey gets a session for its own account', async () => {
    const { userId, device } = await enrol('Ada')
    const { res } = await signIn(device)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.user.id, userId)
    assert.ok(res.body.token.split('.').length === 3, 'a JWT')
    const [credential] = await Credential.forUser(userId)
    assert.equal(credential.sign_count, 1)
    assert.ok(credential.last_used_at)
  })

  test('a challenge works once', async () => {
    const { device } = await enrol('Bea')
    const start = await call('signInOptions')
    const answer = device.sign(start.body.options.challenge)
    assert.equal((await call('signIn', { challengeHandle: start.body.challengeHandle, response: answer })).status, 200)
    const again = await call('signIn', { challengeHandle: start.body.challengeHandle, response: answer })
    assert.equal(again.status, 401)
    assert.doesNotMatch(JSON.stringify(again.body), /token/)
  })

  test('presence without verification is not enough', async () => {
    const { device } = await enrol('Cy')
    const { res } = await signIn(device, { flags: 0x01 })
    assert.equal(res.status, 401)
    assert.equal(res.body.token, undefined)
  })

  test('a passkey nobody enrolled is refused', async () => {
    const { res } = await signIn(authenticator())
    assert.equal(res.status, 401)
    assert.equal(res.body.token, undefined)
  })

  test('an answer to another challenge is refused', async () => {
    const { device } = await enrol('Di')
    const start = await call('signInOptions')
    const res = await call('signIn', { challengeHandle: start.body.challengeHandle, response: device.sign(b64(randomBytes(32))) })
    assert.equal(res.status, 401)
  })

  test('a disabled account stays out', async () => {
    const { userId, device } = await enrol('Ed')
    await db.run('UPDATE users SET disabled_at = ? WHERE id = ?', [new Date().toISOString(), userId])
    const { res } = await signIn(device)
    assert.equal(res.status, 403)
    assert.equal(res.body.token, undefined)
  })

  test('is routed publicly, behind its own limit', () => {
    const routes = read('src/routes/api/passkeys.ts')
    assert.match(routes, /router\.post\('\/api\/auth\/passkey\/sign-in\/options', passkeySignInLimit, PasskeyController\.signInOptions\)/)
    assert.match(routes, /router\.post\('\/api\/auth\/passkey\/sign-in', passkeySignInLimit, PasskeyController\.signIn\)/)
    assert.match(read('src/client/pages/Auth.tsx'), /\/api\/auth\/passkey\/sign-in\/options[\s\S]*signWithPasskey\(options\)[\s\S]*\/api\/auth\/passkey\/sign-in'/)
  })
})

describe('the QR code for an authenticator app', async () => {
  const { qrModules, qrPath } = await load('src/client/qr.ts')

  // Reads the format information back and checks it is level M with a valid
  // BCH code, in both of its copies.
  function format(m) {
    const size = m.length
    const bits = (pairs) => pairs.reduce((v, [x, y], i) => v | ((m[y][x] ? 1 : 0) << i), 0)
    const first = []
    for (let i = 0; i <= 5; i++) first.push([8, i])
    first.push([8, 7], [8, 8], [7, 8])
    for (let i = 9; i < 15; i++) first.push([14 - i, 8])
    const second = []
    for (let i = 0; i < 8; i++) second.push([size - 1 - i, 8])
    for (let i = 8; i < 15; i++) second.push([8, size - 15 + i])
    return [bits(first) ^ 0x5412, bits(second) ^ 0x5412]
  }
  const bchOk = (value) => {
    let rem = value >>> 10
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    return (((value >>> 10) << 10) | rem) === value
  }

  test('grows with the text, by version', () => {
    assert.equal(qrModules('a').length, 21)
    const uri = 'otpauth://totp/BasicBen:ada%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=BasicBen&algorithm=SHA1&digits=6&period=30'
    const m = qrModules(uri)
    assert.equal(m.length, 49, 'version 8')
    assert.ok(qrModules('x'.repeat(1000)).length > 100)
    assert.throws(() => qrModules('x'.repeat(3000)), /Too long/)
  })

  test('has finders in three corners and timing between them', () => {
    const m = qrModules('otpauth://totp/x?secret=ABC')
    const size = m.length
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let i = 0; i < 7; i++) {
        assert.equal(m[oy][ox + i], true, 'top edge')
        assert.equal(m[oy + 6][ox + i], true, 'bottom edge')
      }
      assert.equal(m[oy + 1][ox + 1], false, 'light ring')
      assert.equal(m[oy + 3][ox + 3], true, 'dark centre')
    }
    for (let i = 8; i < size - 8; i++) assert.equal(m[6][i], i % 2 === 0)
    assert.equal(m[size - 8][8], true, 'the dark module')
  })

  test('says level M and its mask the same way twice', () => {
    for (const text of ['a', 'otpauth://totp/x?secret=ABC', 'x'.repeat(400)]) {
      const [a, b] = format(qrModules(text))
      assert.equal(a, b)
      assert.ok(bchOk(a))
      assert.equal(a >>> 13, 0, 'level M')
    }
  })

  test('draws one square per dark module, inside a quiet zone', () => {
    const m = qrModules('a')
    const dark = m.flat().filter(Boolean).length
    const path = qrPath(m)
    assert.equal(path.match(/M/g).length, dark)
    assert.match(path, /^M4 4h1v1h-1z/)
  })

  test('Profile shows it beside the setup key', () => {
    const card = read('src/client/components/admin/SecurityCard.tsx')
    assert.match(card, /<OtpQr uri=\{enrolment\.uri\}/)
    assert.doesNotMatch(read('package.json'), /"qrcode|"qr-/)
  })
})
