/**
 * Create a new router instance
 *
 * @param {Object} [options]
 * @returns {Router}
 */
export function createRouter(options?: any): Router;
export class Router {
    constructor(options?: {});
    prefix: any;
    middleware: any;
    routes: any[];
    namedRoutes: Map<any, any>;
    groups: any[];
    /**
     * HTTP method shortcuts
     */
    get(path: any, ...handlers: any[]): this;
    post(path: any, ...handlers: any[]): this;
    put(path: any, ...handlers: any[]): this;
    patch(path: any, ...handlers: any[]): this;
    delete(path: any, ...handlers: any[]): this;
    head(path: any, ...handlers: any[]): this;
    options(path: any, ...handlers: any[]): this;
    /**
     * Register route for all methods
     */
    all(path: any, ...handlers: any[]): this;
    /**
     * Create a route group with shared prefix and/or middleware
     *
     * Usage:
     *   router.group('/admin', adminAuth, (group) => {
     *     group.get('/users', listUsers)
     *     group.get('/users/:id', showUser)
     *   })
     */
    group(prefix: any, ...args: any[]): this;
    /**
     * Add middleware to all routes in this router
     */
    use(...middleware: any[]): this;
    /**
     * Generate URL for a named route
     *
     * Usage:
     *   router.route('users.show', { id: 1 }) // => '/users/1'
     */
    route(name: any, params?: {}): any;
    /**
     * Match a request to a route
     */
    match(method: any, path: any): {
        route: any;
        params: any;
    };
    /**
     * Apply routes to an app instance
     */
    applyTo(app: any): any;
    /**
     * Get all registered routes (for debugging/listing)
     */
    getRoutes(): {
        method: any;
        path: any;
        name: any;
        middlewareCount: any;
    }[];
    /**
     * Resource routing helper - generates CRUD routes
     *
     * Usage:
     *   router.resource('/users', UserController)
     *
     * Generates:
     *   GET    /users          -> index
     *   GET    /users/:id      -> show
     *   POST   /users          -> create
     *   PUT    /users/:id      -> update
     *   DELETE /users/:id      -> destroy
     */
    resource(path: any, controller: any, options?: {}): Router;
    #private;
}
