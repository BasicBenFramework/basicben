/**
 * Render Markdown into HTML that is safe to place in the document.
 *
 * @param {string} source - Markdown
 * @param {Object} [options]
 * @param {Object} [options.context] - passed to the `content.render` filter
 * @param {string[]} [options.schemes] - URL schemes permitted in links
 * @param {Object} [options.allowed] - sanitizer allowlist override
 * @param {boolean} [options.headingIds] - add ids to headings (default true)
 * @param {boolean} [options.filter] - run the `content.render` hook (default true)
 * @returns {Promise<string>} sanitized HTML
 */
export function renderContent(source: string, options?: {
    context?: any;
    schemes?: string[];
    allowed?: any;
    headingIds?: boolean;
    filter?: boolean;
}): Promise<string>;
/**
 * Synchronous render, without the plugin filter.
 *
 * The editor's preview uses this: it runs in the browser, where the plugin
 * hooks do not exist, and it must produce exactly what the server would produce
 * minus that one step — otherwise the preview is a lie.
 *
 * @param {string} source
 * @param {Object} [options]
 * @returns {string} sanitized HTML
 */
export function renderContentSync(source: string, options?: any): string;
/**
 * A plain-text summary, for meta descriptions and post listings.
 *
 * Built from the Markdown rather than the HTML so that markup never leaks into
 * a `<meta>` tag, and cut at a word boundary so the result does not end
 * mid-word.
 *
 * @param {string} source - Markdown
 * @param {number} [length] - maximum characters
 * @returns {string}
 */
export function excerpt(source: string, length?: number): string;
/**
 * Turn a title into a URL slug.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text: string): string;
/**
 * Read the headings out of a document, for a table of contents.
 *
 * Uses the same slug function the renderer does, so the returned ids match the
 * anchors actually present in the HTML.
 *
 * @param {string} source - Markdown
 * @param {Object} [options]
 * @returns {Array<{level: number, text: string, id: string}>}
 */
export function headings(source: string, options?: any): Array<{
    level: number;
    text: string;
    id: string;
}>;
export { renderMarkdown } from "./markdown.js";
export { sanitizeHtml, stripTags, escapeHtml, decodeEntities, isSafeUrl, DEFAULT_ALLOWED, DEFAULT_ALLOWED_SCHEMES } from "./sanitize.js";
