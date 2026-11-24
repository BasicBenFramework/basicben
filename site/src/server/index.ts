/**
 * The server: the CMS, with the features basicben.config.js lists.
 *
 * Kept as a file so `basicben dev` and `basicben build` find an entry. Your
 * own hook listeners go in a module imported above this line, so they are
 * registered before the server takes a request:
 *
 *   import './hooks.ts'
 */
export { default } from '@basicbenframework/cms/server'
