/// <reference types="vite/client" />

// Injected by `define` in vite.config.ts from DISABLE_REGISTRATION and
// DISABLE_PUBLIC_SITE. Constants rather than runtime lookups, so the routes
// and links they guard are dropped from the bundle when they are off.
declare const __DISABLE_REGISTRATION__: boolean
declare const __DISABLE_PUBLIC_SITE__: boolean
