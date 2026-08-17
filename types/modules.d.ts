/**
 * Whether a filename is application code the framework should import.
 *
 * Test files are excluded so a `posts.test.ts` beside `posts.ts` is not loaded
 * as a route or run as a migration.
 *
 * @param {string} filename
 * @returns {boolean}
 */
export function isModuleFile(filename: string): boolean;
/**
 * Strip a module extension, for turning a filename into a migration name.
 *
 * @param {string} filename
 * @returns {string}
 */
export function stripModuleExtension(filename: string): string;
/**
 * Which files the framework will import as application code.
 *
 * Node strips TypeScript types natively on the versions this framework
 * supports, so a `.ts` route, migration or seeder runs with no build step —
 * as long as it sticks to erasable syntax. A `namespace`, an `enum` or a
 * constructor parameter property emits runtime code that stripping cannot
 * produce, and will fail to load.
 *
 * `.tsx` is deliberately absent: Node does not transform JSX, so anything
 * containing it needs a build step regardless of what it is called. Client
 * components go through Vite instead.
 *
 * This list is shared because it was not. The plugin loader accepted `.ts`
 * while the route loader, the migrator and the seeder each filtered for `.js`,
 * so a TypeScript migration was discovered by nothing and simply never ran —
 * silently, since an empty directory and a directory full of unrecognised
 * files look identical to a caller.
 */
export const MODULE_EXTENSIONS: string[];
