#!/usr/bin/env node
/**
 * `basicben-cms`: the CMS's command-line tools, run from a site.
 *
 *   npx basicben-cms export | import:json | import:wxr | import:ghost |
 *                    import:wordpress | backup | restore  [options]
 *
 * Each takes the same options as before, and `--help` on its own prints the
 * usage at the top of its file. Like `basicben migrate`, a command reads the
 * site's .env and then its basicben.config.js (through core's getDb), from
 * the directory it is run in.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMANDS = {
  export: './export.mjs',
  'import:json': './import-json.mjs',
  'import:wxr': './import-wxr.mjs',
  'import:ghost': './import-ghost.mjs',
  'import:wordpress': './import-wordpress.mjs',
  backup: './backup.mjs',
  restore: './restore.mjs'
}

const [command, ...args] = process.argv.slice(2)

if (!command || command === '--help' || command === '-h' || !Object.hasOwn(COMMANDS, command)) {
  if (command && !['--help', '-h'].includes(command)) console.error(`Unknown command: ${command}\n`)
  console.log(`Usage: basicben-cms <command> [options]\n\nCommands:\n${Object.keys(COMMANDS).map((name) => `  ${name}`).join('\n')}\n\nRun one with --help for its options.`)
  process.exit(command && !['--help', '-h'].includes(command) ? 1 : 0)
}

const file = new URL(COMMANDS[command], import.meta.url)

if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  // The usage block every command opens with.
  const source = readFileSync(fileURLToPath(file), 'utf-8')
  const block = source.match(/\/\*\*([\s\S]*?)\*\//)
  console.log(block ? block[1].replace(/^\s*\* ?/gm, '').trim() : `basicben-cms ${command}`)
  process.exit(0)
}

// What `node --env-file-if-exists=.env` did when these were npm scripts.
if (existsSync(resolve('.env'))) process.loadEnvFile(resolve('.env'))

// The command reads process.argv as if it had been run directly.
process.argv = [process.argv[0], fileURLToPath(file), ...args]
await import(file.href)
