/**
 * Configuration from settings, with the environment winning
 * (src/helpers/config.ts), and the secrets among it (src/helpers/secrets.ts).
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

const { encryptSecret, decryptSecret, isEncrypted } = await load('src/helpers/secrets.ts')
const config = await load('src/helpers/config.ts')
const { settingsStorageConfig, storageSource } = await load('src/helpers/storage.ts')
const { validateSettings, isSecretDefinition } = await load('src/helpers/site-settings.ts')
const { isSecretSetting } = await load('src/helpers/export-data.ts')

const KEY = 'k'.repeat(32)
const VARS = ['SITE_NAME', 'SITE_URL', 'DISABLE_REGISTRATION', 'IMAGE_TRANSFORM_URL', 'S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION',
  'S3_PUBLIC_URL', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'MYSENDBOX_API_KEY', 'MYSENDBOX_API_URL']

beforeEach(() => {
  for (const name of VARS) delete process.env[name]
  process.env.APP_KEY = KEY
  config.setConfigSnapshot({})
})

describe('secrets', () => {
  test('round-trip under the same APP_KEY, with a fresh IV each time', () => {
    const a = encryptSecret('s3cr3t', KEY)
    const b = encryptSecret('s3cr3t', KEY)
    assert.ok(isEncrypted(a))
    assert.notEqual(a, b)
    assert.ok(!a.includes('s3cr3t'))
    assert.equal(decryptSecret(a, KEY), 's3cr3t')
  })

  test('another APP_KEY, an edited value or a plain one reads as null', () => {
    const stored = encryptSecret('s3cr3t', KEY)
    assert.equal(decryptSecret(stored, 'x'.repeat(32)), null)
    assert.equal(decryptSecret(stored.slice(0, -2) + (stored.endsWith('A') ? 'BB' : 'AA'), KEY), null)
    assert.equal(decryptSecret('s3cr3t', KEY), null)
  })

  test('refuses to encrypt without APP_KEY', () => {
    delete process.env.APP_KEY
    assert.throws(() => encryptSecret('x'), /APP_KEY/)
  })
})

describe('the environment wins over settings', () => {
  test('settings are used when the variable is not set', () => {
    config.setConfigSnapshot({ site_url: 'https://from-settings.example', site_name: 'Settings name' })
    assert.equal(config.configValue('SITE_URL'), 'https://from-settings.example')
    assert.equal(config.siteName(), 'Settings name')

    process.env.SITE_URL = 'https://from-env.example'
    assert.equal(config.configValue('SITE_URL'), 'https://from-env.example')
    assert.equal(config.lockedBy('site_url'), 'SITE_URL')
    assert.equal(config.lockedBy('site_name'), null)
  })

  test('registration closes from either side', () => {
    assert.equal(config.registrationOpen(), true)
    config.setConfigSnapshot({ disable_registration: 'true' })
    assert.equal(config.registrationOpen(), false)
    process.env.DISABLE_REGISTRATION = 'false'
    assert.equal(config.registrationOpen(), true, 'the variable, when set, wins either way')
  })

  test('S3_BUCKET puts the whole storage group under the environment', () => {
    config.setConfigSnapshot({ storage_bucket: 'b', storage_access_key_id: 'id', storage_secret_access_key: 'sk', storage_public_url: 'https://m.example' })
    assert.equal(storageSource(), 'settings')
    assert.deepEqual(settingsStorageConfig(), { bucket: 'b', accessKeyId: 'id', secretAccessKey: 'sk', endpoint: '', region: 'auto', publicUrl: 'https://m.example' })

    process.env.S3_BUCKET = 'env-bucket'
    assert.equal(storageSource(), 'env')
    assert.equal(settingsStorageConfig(), null)
    // A key in settings is not mixed into the environment's bucket.
    assert.equal(config.configValue('S3_SECRET_ACCESS_KEY'), '')
    assert.equal(config.lockedBy('storage_secret_access_key'), 'S3_BUCKET')
  })

  test('storage from settings needs a bucket and both keys', () => {
    config.setConfigSnapshot({ storage_bucket: 'b', storage_access_key_id: 'id' })
    assert.equal(settingsStorageConfig(), null)
    assert.equal(storageSource(), 'default')
  })

  test('the status list never carries a secret', () => {
    config.setConfigSnapshot({ mysendbox_api_key: 'msb_live_123', storage_secret_access_key: 'sk', site_url: 'https://a.example' })
    const listed = config.describeConfig()
    assert.ok(!JSON.stringify(listed).includes('msb_live_123'))
    assert.ok(!JSON.stringify(listed).includes('"sk"'))
    const key = listed.find((entry) => entry.env === 'MYSENDBOX_API_KEY')
    assert.equal(key.source, 'settings')
    assert.equal(key.value, null)
    assert.equal(listed.find((entry) => entry.env === 'SITE_URL').value, 'https://a.example')
  })
})

describe('the new settings', () => {
  test('secrets are declared, and fall under the export and backup rule', () => {
    for (const key of ['storage_access_key_id', 'storage_secret_access_key']) {
      assert.ok(isSecretDefinition(key), key)
      assert.ok(isSecretSetting(key), `${key} would be exported`)
    }
    assert.ok(isSecretSetting('mysendbox_api_key'))
    assert.ok(!isSecretSetting('storage_bucket'))
  })

  test('validate their values', () => {
    assert.ok('values' in validateSettings({ image_transform_url: '{url}?width={width}' }))
    assert.ok('values' in validateSettings({ image_transform_url: 'https://cdn.example/w={width}/{url_encoded}' }))
    assert.ok('errors' in validateSettings({ image_transform_url: 'https://cdn.example/{url}' }))
    assert.ok('errors' in validateSettings({ storage_endpoint: 'not a url' }))
    assert.ok('errors' in validateSettings({ site_url: 'ftp://x' }))
    assert.ok('values' in validateSettings({ disable_registration: 'true', storage_bucket: 'media' }))
  })
})
