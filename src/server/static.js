/**
 * Static file serving middleware.
 * Serves files from a directory with caching headers.
 */

import { createReadStream, statSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'

const mimeTypes = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.zip': 'application/zip'
}

const defaults = {
  dir: 'public',
  prefix: '/',
  maxAge: 86400, // 24 hours in seconds
  index: 'index.html',
  dotfiles: 'ignore', // 'ignore', 'allow', 'deny'
  spa: false, // serve index.html for unmatched client routes
  spaExclude: [/^\/api\//]
}

export function serveStatic(options = {}) {
  const config = { ...defaults, ...options }
  const root = resolve(process.cwd(), config.dir)
  const prefix = config.prefix.endsWith('/') ? config.prefix : config.prefix + '/'

  return (req, res, next) => {
    // Only handle GET and HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next()
    }

    // Check if path starts with prefix
    let urlPath = req.path || req.url.split('?')[0]
    if (!urlPath.startsWith(prefix) && urlPath !== config.prefix.replace(/\/$/, '')) {
      return next()
    }

    // Remove prefix to get file path
    let filePath = urlPath.slice(prefix.length - 1) || '/'

    // Prevent directory traversal
    if (filePath.includes('..')) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    // Handle dotfiles
    const segments = filePath.split('/')
    const hasDotfile = segments.some(s => s.startsWith('.') && s !== '.')
    if (hasDotfile) {
      if (config.dotfiles === 'deny') {
        res.statusCode = 403
        res.end('Forbidden')
        return
      }
      if (config.dotfiles === 'ignore') {
        return next()
      }
    }

    let fullPath = join(root, filePath)

    // Check if file exists
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      return next()
    }

    // If directory, try index file
    if (stat.isDirectory()) {
      const indexPath = join(fullPath, config.index)
      try {
        stat = statSync(indexPath)
        if (!stat.isFile()) return next()
        fullPath = indexPath  // Update fullPath to point to the index file
      } catch {
        return next()
      }
    }

    if (!stat.isFile()) {
      return next()
    }

    // Get mime type
    const ext = extname(fullPath).toLowerCase()
    const mime = mimeTypes[ext] || 'application/octet-stream'

    // Set headers
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Length', stat.size)
    res.setHeader('Cache-Control', `public, max-age=${config.maxAge}`)
    res.setHeader('Last-Modified', stat.mtime.toUTCString())

    // Handle HEAD request
    if (req.method === 'HEAD') {
      res.end()
      return
    }

    // Stream file
    const stream = createReadStream(fullPath)
    stream.pipe(res)
    stream.on('error', (err) => {
      console.error('Static file error:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    })
  }
}

/**
 * SPA history fallback.
 *
 * Wraps a not-found handler so unmatched client routes serve index.html and the
 * browser-side router can take over. Intended for `onNoMatch`, which runs after
 * route matching — putting this in the middleware chain would shadow the API,
 * since static middleware runs before routes are matched.
 */
export function spaFallback(options = {}, next) {
  const config = { ...defaults, ...options }
  const root = resolve(process.cwd(), config.dir)
  const indexPath = join(root, config.index)
  const exclude = config.spaExclude || defaults.spaExclude

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next(req, res)
    }

    const urlPath = req.path || req.url.split('?')[0]

    if (exclude.some((pattern) => pattern.test(urlPath))) {
      return next(req, res)
    }

    // A request for a missing asset should 404, not receive the app shell —
    // returning HTML for a .js request produces a confusing MIME type error.
    const ext = extname(urlPath).toLowerCase()
    if (ext && ext !== '.html') {
      return next(req, res)
    }

    let stat
    try {
      stat = statSync(indexPath)
    } catch {
      return next(req, res)
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html')
    res.setHeader('Content-Length', stat.size)
    // The shell references hashed assets that change on every build, so it must
    // never be cached — a stale shell points at files that no longer exist.
    res.setHeader('Cache-Control', 'no-cache')

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    const stream = createReadStream(indexPath)
    stream.pipe(res)
    stream.on('error', (err) => {
      console.error('SPA fallback error:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    })
  }
}
