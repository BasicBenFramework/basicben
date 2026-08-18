/**
 * Custom argument parser. No Commander.js needed.
 *
 * Handles:
 * - Commands: basicben dev, basicben make:controller
 * - Positional args: basicben make:controller UserController
 * - Flags: --port=3000, --verbose, -v
 */

export function parseArgs(argv) {
  const result = {
    command: null,
    args: [],
    flags: {}
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    // Long flag with value: --port=3000
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, value] = arg.slice(2).split('=')
      result.flags[key] = value
      continue
    }

    // Long flag: --verbose (boolean) or --port 3000 (with next arg)
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]

      // If next arg exists and isn't a flag, use it as value
      if (next && !next.startsWith('-')) {
        result.flags[key] = next
        i++ // skip next
      } else {
        result.flags[key] = true
      }
      continue
    }

    // Short flags: -v, -p 3000
    if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1)
      const next = argv[i + 1]

      if (next && !next.startsWith('-')) {
        result.flags[key] = next
        i++
      } else {
        result.flags[key] = true
      }
      continue
    }

    // Combined short flags: -abc (multiple booleans)
    if (arg.startsWith('-') && arg.length > 2) {
      for (const char of arg.slice(1)) {
        result.flags[char] = true
      }
      continue
    }

    // First non-flag is the command
    if (!result.command) {
      result.command = arg
      continue
    }

    // Everything else is a positional arg
    result.args.push(arg)
  }

  return result
}

/**
 * Expand flag aliases to full names
 */
export function expandAliases(flags, aliases) {
  const expanded = { ...flags }

  for (const [short, long] of Object.entries(aliases)) {
    if (expanded[short] !== undefined && expanded[long] === undefined) {
      expanded[long] = expanded[short]
      delete expanded[short]
    }
  }

  return expanded
}
