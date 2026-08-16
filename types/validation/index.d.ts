/**
 * Validate data against rules
 *
 * @param {Object} data - Data to validate
 * @param {Object} schema - Validation schema { field: [rules] }
 * @returns {ValidationResult}
 *
 * @example
 * const result = await validate(req.body, {
 *   email: [rules.required, rules.email],
 *   password: [rules.required, rules.min(8)]
 * })
 *
 * if (result.fails()) {
 *   return res.status(422).json({ errors: result.errors })
 * }
 */
export function validate(data: any, schema: any): ValidationResult;
/**
 * Create custom rule with custom message
 */
export function rule(validator: any, message: any): (value: any, field: any, data: any) => Promise<any>;
export namespace rules {
    export function required(value: any, field: any): string;
    export let optional: string;
    export function string(value: any, field: any): string;
    export function numeric(value: any, field: any): string;
    export function integer(value: any, field: any): string;
    export function boolean(value: any, field: any): string;
    export function array(value: any, field: any): string;
    export function email(value: any, field: any): string;
    export function url(value: any, field: any): string;
    export function min(minValue: any): (value: any, field: any) => string;
    export function max(maxValue: any): (value: any, field: any) => string;
    export function between(min: any, max: any): (value: any, field: any) => string;
    export function _in(...allowed: any[]): (value: any, field: any) => string;
    export { _in as in };
    export function notIn(...disallowed: any[]): (value: any, field: any) => string;
    export function regex(pattern: any): (value: any, field: any) => string;
    export function confirmed(confirmField: any): (value: any, field: any, data: any) => string;
    export function different(otherField: any): (value: any, field: any, data: any) => string;
    export function length(len: any): (value: any, field: any) => string;
    export function alphanumeric(value: any, field: any): string;
    export function alpha(value: any, field: any): string;
    export function date(value: any, field: any): string;
    export function before(dateStr: any): (value: any, field: any) => string;
    export function after(dateStr: any): (value: any, field: any) => string;
    export function unique(table: string, column?: string, exceptId?: number | string): (value: any, field: any) => Promise<string>;
    export function exists(table: string, column?: string): (value: any, field: any) => Promise<string>;
}
/**
 * Validation result class
 */
declare class ValidationResult {
    constructor(errors: any);
    errors: any;
    /**
     * Check if validation failed
     */
    fails(): boolean;
    /**
     * Check if validation passed
     */
    passes(): boolean;
    /**
     * Get first error for a field
     */
    first(field: any): any;
    /**
     * Get all errors as flat array
     */
    all(): {
        field: string;
        message: any;
    }[];
}
export {};
