/**
 * Command dispatcher. Maps command names to handlers.
 */

import { bold, red, cyan, yellow, dim } from './colors.js'

// Command registry
const commands = {
  // Development
  dev: () => import('../commands/dev.js'),
  build: () => import('../commands/build.js'),
  start: () => import('../commands/start.js'),
  test: () => import('../commands/test.js'),

  // Scaffolding
  'make:controller': () => import('../commands/make-controller.js'),
  'make:model': () => import('../commands/make-model.js'),
  'make:route': () => import('../commands/make-route.js'),
  'make:migration': () => import('../commands/make-migration.js'),
  'make:middleware': () => import('../commands/make-middleware.js'),

  // Database
  migrate: () => import('../commands/migrate.js'),
  'migrate:rollback': () => import('../commands/migrate-rollback.js'),
  'migrate:fresh': () => import('../commands/migrate-fresh.js'),
  'migrate:status': () => import('../commands/migrate-status.js'),
  'migrate:make': () => import('../commands/make-migration.js'), // alias

  // Content
  'content:rerender': () => import('../commands/content-rerender.js'),

  // Seeding
  seed: () => import('../commands/seed.js'),
  'db:seed': () => import('../commands/seed.js'), // alias
  'make:seed': () => import('../commands/make-seed.js'),

  // Updates & Package Management
  updates: () => import('../commands/updates.js'),
  plugin: () => import('../commands/plugin.js'),
  registry: () => import('../commands/registry.js'),
  license: () => import('../commands/license.js'),

  // Help
  help: () => import('../commands/help.js')
}

// Command metadata for help display
export const commandMeta = {
  dev: {
    description: 'Start development server (Vite + Node with hot reload)',
    usage: 'basicben dev',
    options: {
      '--port <port>': 'API server port (default: 3001)'
    }
  },
  build: {
    description: 'Build client and server for production',
    usage: 'basicben build',
    options: {
      '--static': 'Build client only (for static hosts like CF Pages)'
    }
  },
  start: {
    description: 'Start production server',
    usage: 'basicben start',
    options: {
      '--port <port>': 'Server port (default: 3000)'
    }
  },
  test: {
    description: 'Run tests with Vitest',
    usage: 'basicben test [files]',
    options: {
      '--watch, -w': 'Watch mode (re-run on changes)',
      '--coverage': 'Generate coverage report',
      '--ui': 'Open Vitest UI'
    }
  },

  'make:controller': {
    description: 'Generate a controller with CRUD methods',
    usage: 'basicben make:controller <Name>',
    example: 'basicben make:controller User'
  },
  'make:model': {
    description: 'Generate a model with common database methods',
    usage: 'basicben make:model <Name>',
    example: 'basicben make:model User'
  },
  'make:route': {
    description: 'Generate a route file with REST endpoints',
    usage: 'basicben make:route <name>',
    example: 'basicben make:route users'
  },
  'make:migration': {
    description: 'Generate a timestamped migration file',
    usage: 'basicben make:migration <name>',
    example: 'basicben make:migration create_users_table'
  },
  'make:middleware': {
    description: 'Generate middleware (includes auth template)',
    usage: 'basicben make:middleware <name>',
    example: 'basicben make:middleware auth'
  },

  migrate: {
    description: 'Run all pending migrations',
    usage: 'basicben migrate'
  },
  'migrate:rollback': {
    description: 'Roll back the last migration batch',
    usage: 'basicben migrate:rollback'
  },
  'migrate:fresh': {
    description: 'Drop all tables and re-run all migrations',
    usage: 'basicben migrate:fresh'
  },
  'migrate:status': {
    description: 'Show which migrations have run',
    usage: 'basicben migrate:status'
  },

  'content:rerender': {
    description: 'Rebuild rendered HTML from the Markdown source',
    usage: 'basicben content:rerender [table...]',
    options: {
      '--dry-run': 'Report what would change without writing'
    },
    example: 'basicben content:rerender posts'
  },

  seed: {
    description: 'Run database seeders',
    usage: 'basicben seed [name]',
    example: 'basicben seed users'
  },
  'make:seed': {
    description: 'Generate a new seed file',
    usage: 'basicben make:seed <name>',
    example: 'basicben make:seed users'
  },

  updates: {
    description: 'Check for and apply framework updates',
    usage: 'basicben updates [check|apply|changelog]',
    options: {
      'check': 'Check for available updates',
      'apply': 'Apply core update',
      'changelog': 'View changelog for latest version',
      '--json': 'Output as JSON',
      '-y, --yes': 'Skip confirmation prompts'
    }
  },
  plugin: {
    description: 'Manage plugins',
    usage: 'basicben plugin <command> [options]',
    options: {
      'list': 'List installed plugins',
      'search <query>': 'Search plugin registry',
      'install <slug>': 'Install a plugin',
      'update <slug>': 'Update a plugin',
      'update --all': 'Update all plugins',
      'remove <slug>': 'Remove a plugin',
      'activate <slug>': 'Activate a plugin',
      'deactivate <slug>': 'Deactivate a plugin'
    }
  },
  registry: {
    description: 'Manage plugin registries',
    usage: 'basicben registry <command> [options]',
    options: {
      'list': 'List configured registries',
      'add <url>': 'Add a registry',
      'remove <url>': 'Remove a registry',
      'ping [url]': 'Test registry connection(s)'
    }
  },
  license: {
    description: 'Manage license key',
    usage: 'basicben license <command>',
    options: {
      'set <key>': 'Set license key',
      'status': 'Show license status',
      'remove': 'Remove license key'
    }
  },

  help: {
    description: 'Show help for a command',
    usage: 'basicben help [command]'
  }
}

export async function dispatch(command, args, flags) {
  // Version flag (check first)
  if (flags.version || flags.v) {
    const pkg = await import('../../package.json', { with: { type: 'json' } })
    console.log(pkg.default.version)
    return
  }

  // No command or help flag
  if (!command || flags.help || flags.h) {
    const helpModule = await commands.help()
    return helpModule.run(args, flags)
  }

  // Look up command
  const loader = commands[command]

  if (!loader) {
    console.error(`\n${red('Error:')} Unknown command ${bold(command)}`)
    console.error(`\nRun ${cyan('basicben help')} to see available commands.\n`)
    process.exit(1)
  }

  try {
    const module = await loader()
    await module.run(args, flags)
  } catch (err) {
    // Handle module not found (command not implemented yet)
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(`\n${yellow('Not implemented:')} ${bold(command)}`)
      console.error(`${dim('This command is coming soon.')}\n`)
      process.exit(1)
    }

    // Re-throw other errors
    throw err
  }
}
