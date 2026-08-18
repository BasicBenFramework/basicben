/**
 * Generate a file from a stub template
 *
 * @param {string} stubName - Name of stub file (without .stub extension)
 * @param {string} targetPath - Where to write the generated file
 * @param {Object} replacements - Key-value pairs for placeholder replacement
 */
export function generate(stubName: string, targetPath: string, replacements?: any): string;
/**
 * Transform name to different cases
 */
export function transformName(name: any): {
    original: any;
    pascal: any;
    camel: any;
    snake: any;
    kebab: any;
    lower: any;
    pluralLower: string;
    pluralSnake: string;
};
/**
 * Generate timestamp for migration files
 */
export function timestamp(): string;
