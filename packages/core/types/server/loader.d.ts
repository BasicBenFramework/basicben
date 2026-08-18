/**
 * Load all route files from a directory.
 * Each file should export a default function that receives the router.
 *
 * @param {string} dir - Directory to scan (default: src/routes)
 * @returns {Router} - Router with all routes loaded
 */
export function loadRoutes(dir?: string): Router;
/**
 * Load all middleware files from a directory.
 * Files are loaded in alphabetical order.
 * Each file should export a default middleware function.
 *
 * @param {string} dir - Directory to scan (default: src/middleware)
 * @returns {Function[]} - Array of middleware functions
 */
export function loadMiddleware(dir?: string): Function[];
/**
 * Load config file if it exists
 *
 * @returns {Object} - Config object or empty defaults
 */
export function loadConfig(): any;
import { Router } from './router.js';
