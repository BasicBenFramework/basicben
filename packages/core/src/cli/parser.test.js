/**
 * Tests for the arg parser
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { parseArgs, expandAliases } from './parser.js'

describe('parseArgs', () => {
  test('parses command only', () => {
    const result = parseArgs(['dev'])
    assert.strictEqual(result.command, 'dev')
    assert.deepStrictEqual(result.args, [])
    assert.deepStrictEqual(result.flags, {})
  })

  test('parses command with positional args', () => {
    const result = parseArgs(['make:controller', 'UserController'])
    assert.strictEqual(result.command, 'make:controller')
    assert.deepStrictEqual(result.args, ['UserController'])
  })

  test('parses long flags with =', () => {
    const result = parseArgs(['dev', '--port=3000'])
    assert.strictEqual(result.flags.port, '3000')
  })

  test('parses long flags with space', () => {
    const result = parseArgs(['dev', '--port', '3000'])
    assert.strictEqual(result.flags.port, '3000')
  })

  test('parses boolean long flags', () => {
    const result = parseArgs(['dev', '--verbose'])
    assert.strictEqual(result.flags.verbose, true)
  })

  test('parses short flags with value', () => {
    const result = parseArgs(['dev', '-p', '3000'])
    assert.strictEqual(result.flags.p, '3000')
  })

  test('parses boolean short flags', () => {
    const result = parseArgs(['dev', '-v'])
    assert.strictEqual(result.flags.v, true)
  })

  test('parses combined short flags', () => {
    const result = parseArgs(['dev', '-abc'])
    assert.strictEqual(result.flags.a, true)
    assert.strictEqual(result.flags.b, true)
    assert.strictEqual(result.flags.c, true)
  })

  test('handles empty argv', () => {
    const result = parseArgs([])
    assert.strictEqual(result.command, null)
    assert.deepStrictEqual(result.args, [])
    assert.deepStrictEqual(result.flags, {})
  })

  test('flags before command consume next arg as value', () => {
    // Note: --flag before command treats next arg as flag value
    // Use --flag=value or put flags after command for clarity
    const result = parseArgs(['--verbose', 'dev'])
    assert.strictEqual(result.flags.verbose, 'dev')
    assert.strictEqual(result.command, null)
  })

  test('flags after command work correctly', () => {
    const result = parseArgs(['dev', '--verbose'])
    assert.strictEqual(result.command, 'dev')
    assert.strictEqual(result.flags.verbose, true)
  })
})

describe('expandAliases', () => {
  test('expands short flags to long names', () => {
    const flags = { v: true, p: '3000' }
    const aliases = { v: 'verbose', p: 'port' }
    const result = expandAliases(flags, aliases)

    assert.strictEqual(result.verbose, true)
    assert.strictEqual(result.port, '3000')
    assert.strictEqual(result.v, undefined)
    assert.strictEqual(result.p, undefined)
  })

  test('preserves long flags that already exist', () => {
    const flags = { v: true, verbose: false }
    const aliases = { v: 'verbose' }
    const result = expandAliases(flags, aliases)

    assert.strictEqual(result.verbose, false) // long flag takes precedence
  })
})
