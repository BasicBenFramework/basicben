/**
 * Create a minimal HTTP server instance
 */
export function createApp(options?: {}): {
    use: (...handlers: any[]) => /*elided*/ any;
    server: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
    get: (path: any, ...handlers: any[]) => /*elided*/ any;
    post: (path: any, ...handlers: any[]) => /*elided*/ any;
    put: (path: any, ...handlers: any[]) => /*elided*/ any;
    patch: (path: any, ...handlers: any[]) => /*elided*/ any;
    delete: (path: any, ...handlers: any[]) => /*elided*/ any;
    head: (path: any, ...handlers: any[]) => /*elided*/ any;
    options: (path: any, ...handlers: any[]) => /*elided*/ any;
    /**
     * Start listening
     */
    listen(port: any, callback: any): /*elided*/ any;
    /**
     * Close the server
     */
    close(callback: any): void;
};
