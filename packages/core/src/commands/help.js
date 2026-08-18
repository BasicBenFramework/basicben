/**
 * Help command. Shows available commands and usage.
 */

import { bold, cyan, dim, yellow } from '../cli/colors.js'
import { commandMeta } from '../cli/dispatcher.js'

export async function run(args, flags) {
  const specificCommand = args[0]

  if (specificCommand) {
    showCommandHelp(specificCommand)
  } else {
    showGeneralHelp()
  }
}

function showGeneralHelp() {
  console.log(`
${bold('BasicBen')} — A full-stack framework for React

${bold('Usage:')}
  basicben <command> [options]

${bold('Development')}
  ${cyan('dev')}                Start Vite + Node dev server
  ${cyan('build')}              Build for production
  ${cyan('start')}              Start production server
  ${cyan('test')}               Run tests with Vitest

${bold('Scaffolding')}
  ${cyan('make:controller')}    Generate a controller
  ${cyan('make:model')}         Generate a model
  ${cyan('make:route')}         Generate a route file
  ${cyan('make:migration')}     Generate a migration file
  ${cyan('make:middleware')}    Generate middleware

${bold('Database')}
  ${cyan('migrate')}            Run pending migrations
  ${cyan('migrate:rollback')}   Roll back last batch
  ${cyan('migrate:fresh')}      Drop all and re-run
  ${cyan('migrate:status')}     Show migration status
  ${cyan('seed')}               Run database seeders

${bold('Options')}
  ${cyan('--help, -h')}         Show help
  ${cyan('--version, -v')}      Show version

Run ${cyan('basicben help <command>')} for details on a specific command.
`)
}

function showCommandHelp(command) {
  const meta = commandMeta[command]

  if (!meta) {
    console.log(`\n${yellow('Unknown command:')} ${command}`)
    console.log(`Run ${cyan('basicben help')} to see available commands.\n`)
    return
  }

  console.log(`
${bold('Command:')} ${cyan(command)}

${meta.description}

${bold('Usage:')}
  ${meta.usage}
`)

  // Add command-specific options if available
  if (meta.options) {
    console.log(`${bold('Options:')}`)
    for (const [flag, desc] of Object.entries(meta.options)) {
      console.log(`  ${cyan(flag)}  ${desc}`)
    }
    console.log()
  }

  // Add example if available
  if (meta.example) {
    console.log(`${bold('Example:')}`)
    console.log(`  ${dim('$')} ${meta.example}\n`)
  }
}
