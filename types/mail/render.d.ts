/**
 * Render the text and HTML parts of a named template.
 *
 * Looks for `<dir>/<name>.txt` and `<dir>/<name>.html`; either may be absent.
 *
 * @param {string} name
 * @param {Object} [data] - values for {{placeholders}}
 * @param {string} [dir] - template directory, relative to cwd
 * @returns {{ text?: string, html?: string }}
 */
export function renderMail(name: string, data?: any, dir?: string): {
    text?: string;
    html?: string;
};
/**
 * Replace {{key}} with its value.
 *
 * HTML escaping is applied to values substituted into an HTML template, since a
 * name or a subject can come from user input. Use {{{key}}} to opt out where
 * the value is known-safe markup.
 *
 * @param {string} template
 * @param {Object} data
 * @param {boolean} [escape]
 * @returns {string}
 */
export function interpolate(template: string, data?: any, escape?: boolean): string;
