/**
 * Custom argument parser. No Commander.js needed.
 *
 * Handles:
 * - Commands: basicben dev, basicben make:controller
 * - Positional args: basicben make:controller UserController
 * - Flags: --port=3000, --verbose, -v
 */
export function parseArgs(argv: any): {
    command: any;
    args: any[];
    flags: {};
};
/**
 * Expand flag aliases to full names
 */
export function expandAliases(flags: any, aliases: any): any;
