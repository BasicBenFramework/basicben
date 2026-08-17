import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  parseVersion,
  compareVersions,
  isNewer,
  isOlder,
  isEqual,
  satisfies,
  getChannel,
  incrementVersion
} from './version.js'

describe('Version Utilities', () => {
  describe('parseVersion', () => {
    test('parses simple version', () => {
      const result = parseVersion('1.2.3')
      assert.strictEqual(result.major, 1)
      assert.strictEqual(result.minor, 2)
      assert.strictEqual(result.patch, 3)
      assert.strictEqual(result.prerelease, null)
    })

    test('parses version with v prefix', () => {
      const result = parseVersion('v1.2.3')
      assert.strictEqual(result.major, 1)
      assert.strictEqual(result.minor, 2)
      assert.strictEqual(result.patch, 3)
    })

    test('parses version with prerelease', () => {
      const result = parseVersion('1.2.3-beta.1')
      assert.strictEqual(result.major, 1)
      assert.strictEqual(result.minor, 2)
      assert.strictEqual(result.patch, 3)
      assert.strictEqual(result.prerelease, 'beta.1')
    })

    test('parses version with build metadata', () => {
      const result = parseVersion('1.2.3+build.123')
      assert.strictEqual(result.major, 1)
      assert.strictEqual(result.build, 'build.123')
    })

    test('returns null for invalid version', () => {
      assert.strictEqual(parseVersion('invalid'), null)
      assert.strictEqual(parseVersion('1.2'), null)
      assert.strictEqual(parseVersion(null), null)
    })
  })

  describe('compareVersions', () => {
    test('compares major versions', () => {
      assert.strictEqual(compareVersions('2.0.0', '1.0.0'), 1)
      assert.strictEqual(compareVersions('1.0.0', '2.0.0'), -1)
    })

    test('compares minor versions', () => {
      assert.strictEqual(compareVersions('1.2.0', '1.1.0'), 1)
      assert.strictEqual(compareVersions('1.1.0', '1.2.0'), -1)
    })

    test('compares patch versions', () => {
      assert.strictEqual(compareVersions('1.0.2', '1.0.1'), 1)
      assert.strictEqual(compareVersions('1.0.1', '1.0.2'), -1)
    })

    test('equal versions return 0', () => {
      assert.strictEqual(compareVersions('1.2.3', '1.2.3'), 0)
    })

    test('stable > prerelease', () => {
      assert.strictEqual(compareVersions('1.0.0', '1.0.0-beta.1'), 1)
      assert.strictEqual(compareVersions('1.0.0-beta.1', '1.0.0'), -1)
    })

    test('compares prerelease versions', () => {
      assert.strictEqual(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1)
      assert.strictEqual(compareVersions('1.0.0-beta.1', '1.0.0-beta.2'), -1)
      assert.strictEqual(compareVersions('1.0.0-rc.1', '1.0.0-beta.1'), 1)
    })

    test('throws on invalid version', () => {
      assert.throws(() => compareVersions('invalid', '1.0.0'))
    })
  })

  describe('isNewer', () => {
    test('returns true if first version is newer', () => {
      assert.strictEqual(isNewer('2.0.0', '1.0.0'), true)
      assert.strictEqual(isNewer('1.1.0', '1.0.0'), true)
      assert.strictEqual(isNewer('1.0.1', '1.0.0'), true)
    })

    test('returns false if first version is older or equal', () => {
      assert.strictEqual(isNewer('1.0.0', '2.0.0'), false)
      assert.strictEqual(isNewer('1.0.0', '1.0.0'), false)
    })
  })

  describe('isOlder', () => {
    test('returns true if first version is older', () => {
      assert.strictEqual(isOlder('1.0.0', '2.0.0'), true)
    })

    test('returns false if first version is newer or equal', () => {
      assert.strictEqual(isOlder('2.0.0', '1.0.0'), false)
      assert.strictEqual(isOlder('1.0.0', '1.0.0'), false)
    })
  })

  describe('isEqual', () => {
    test('returns true for equal versions', () => {
      assert.strictEqual(isEqual('1.0.0', '1.0.0'), true)
      assert.strictEqual(isEqual('1.2.3-beta.1', '1.2.3-beta.1'), true)
    })

    test('returns false for different versions', () => {
      assert.strictEqual(isEqual('1.0.0', '1.0.1'), false)
    })
  })

  describe('satisfies', () => {
    test('exact match', () => {
      assert.strictEqual(satisfies('=1.0.0', '1.0.0'), true)
      assert.strictEqual(satisfies('1.0.0', '1.0.0'), true)
      assert.strictEqual(satisfies('=1.0.0', '1.0.1'), false)
    })

    test('greater than', () => {
      assert.strictEqual(satisfies('>1.0.0', '1.0.1'), true)
      assert.strictEqual(satisfies('>1.0.0', '2.0.0'), true)
      assert.strictEqual(satisfies('>1.0.0', '1.0.0'), false)
    })

    test('greater than or equal', () => {
      assert.strictEqual(satisfies('>=1.0.0', '1.0.0'), true)
      assert.strictEqual(satisfies('>=1.0.0', '1.0.1'), true)
      assert.strictEqual(satisfies('>=1.0.0', '0.9.0'), false)
    })

    test('less than', () => {
      assert.strictEqual(satisfies('<2.0.0', '1.0.0'), true)
      assert.strictEqual(satisfies('<2.0.0', '2.0.0'), false)
    })

    test('less than or equal', () => {
      assert.strictEqual(satisfies('<=2.0.0', '2.0.0'), true)
      assert.strictEqual(satisfies('<=2.0.0', '1.0.0'), true)
      assert.strictEqual(satisfies('<=2.0.0', '2.0.1'), false)
    })

    test('caret (^) - same major', () => {
      assert.strictEqual(satisfies('^1.0.0', '1.0.0'), true)
      assert.strictEqual(satisfies('^1.0.0', '1.5.0'), true)
      assert.strictEqual(satisfies('^1.0.0', '1.9.9'), true)
      assert.strictEqual(satisfies('^1.0.0', '2.0.0'), false)
      assert.strictEqual(satisfies('^1.0.0', '0.9.0'), false)
    })

    test('tilde (~) - same major.minor', () => {
      assert.strictEqual(satisfies('~1.2.0', '1.2.0'), true)
      assert.strictEqual(satisfies('~1.2.0', '1.2.5'), true)
      assert.strictEqual(satisfies('~1.2.0', '1.3.0'), false)
      assert.strictEqual(satisfies('~1.2.0', '1.1.0'), false)
    })

    test('returns false for invalid input', () => {
      assert.strictEqual(satisfies(null, '1.0.0'), false)
      assert.strictEqual(satisfies('>=1.0.0', null), false)
    })
  })

  describe('getChannel', () => {
    test('identifies stable releases', () => {
      assert.strictEqual(getChannel('1.0.0'), 'stable')
      assert.strictEqual(getChannel('2.5.3'), 'stable')
    })

    test('identifies beta releases', () => {
      assert.strictEqual(getChannel('1.0.0-beta.1'), 'beta')
      assert.strictEqual(getChannel('1.0.0-beta'), 'beta')
    })

    test('identifies alpha releases', () => {
      assert.strictEqual(getChannel('1.0.0-alpha.1'), 'alpha')
    })

    test('identifies rc releases', () => {
      assert.strictEqual(getChannel('1.0.0-rc.1'), 'rc')
    })

    test('identifies dev releases', () => {
      assert.strictEqual(getChannel('1.0.0-dev.1'), 'dev')
      assert.strictEqual(getChannel('1.0.0-canary.1'), 'dev')
    })

    test('returns unknown for invalid version', () => {
      assert.strictEqual(getChannel('invalid'), 'unknown')
    })
  })

  describe('incrementVersion', () => {
    test('increments major version', () => {
      assert.strictEqual(incrementVersion('1.2.3', 'major'), '2.0.0')
    })

    test('increments minor version', () => {
      assert.strictEqual(incrementVersion('1.2.3', 'minor'), '1.3.0')
    })

    test('increments patch version', () => {
      assert.strictEqual(incrementVersion('1.2.3', 'patch'), '1.2.4')
    })

    test('increments prerelease version', () => {
      assert.strictEqual(incrementVersion('1.0.0-beta.1', 'prerelease'), '1.0.0-beta.2')
    })

    test('creates prerelease from stable', () => {
      const result = incrementVersion('1.0.0', 'prerelease')
      assert.ok(result.includes('beta'))
    })

    test('throws on invalid version', () => {
      assert.throws(() => incrementVersion('invalid', 'patch'))
    })

    test('throws on unknown release type', () => {
      assert.throws(() => incrementVersion('1.0.0', 'unknown'))
    })
  })
})
