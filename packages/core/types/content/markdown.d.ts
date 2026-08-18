/**
 * Render Markdown to HTML.
 *
 * @param {string} source
 * @param {Object} [options]
 * @param {string[]} [options.schemes] - URL schemes permitted in links/images
 * @param {boolean} [options.headingIds] - add `id` to headings for anchors
 * @param {(text: string) => string} [options.slugify]
 * @returns {string} HTML. Contains only tags this module emits.
 */
export function renderMarkdown(source: string, options?: {
    schemes?: string[];
    headingIds?: boolean;
    slugify?: (text: string) => string;
}): string;
/**
 * Parse and render the inline content of one block.
 *
 * @param {string} text
 * @param {Object} context
 * @returns {string} HTML
 */
export function renderInlines(text: string, context: any): string;
/**
 * Turn a title into a URL slug.
 *
 * @param {string} text
 * @returns {string}
 */
export function defaultSlugify(text: string): string;
