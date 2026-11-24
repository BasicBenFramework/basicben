/// <reference types="vite/client" />

// Injected by `define` in vite.config.ts from DISABLE_REGISTRATION and
// DISABLE_PUBLIC_SITE. Constants rather than runtime lookups, so the routes
// and links they guard are dropped from the bundle when they are off.
declare const __DISABLE_REGISTRATION__: boolean
declare const __DISABLE_PUBLIC_SITE__: boolean

// The site's `features` from basicben.config.js, checked by enabledFeatureNames
// in vite.config.ts. src/main.tsx loads only these features' admin halves.
declare const __BASICBEN_FEATURES__: string[]
