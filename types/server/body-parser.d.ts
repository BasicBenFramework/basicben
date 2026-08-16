/**
 * Body parser middleware.
 * Parses JSON and URL-encoded bodies.
 *
 * No dependencies - uses native Node.js APIs.
 */
/**
 * Parse request body based on content-type
 */
export function bodyParser(options?: {}): (req: any, res: any, next: any) => Promise<any>;
/**
 * JSON-only body parser
 */
export function json(options?: {}): (req: any, res: any, next: any) => Promise<any>;
