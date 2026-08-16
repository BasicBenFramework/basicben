/**
 * Tests for the Router class
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { Router, createRouter } from './router.js'
import { createApp } from './http.js'

describe('Router', () => {
  test('registers GET routes', () => {
    const router = new Router()
    router.get('/users', () => {})

    const routes = router.getRoutes()
    assert.strictEqual(routes.length, 1)
    assert.strictEqual(routes[0].method, 'GET')
    assert.strictEqual(routes[0].path, '/users')
  })

  test('registers POST routes', () => {
    const router = new Router()
    router.post('/users', () => {})

    const routes = router.getRoutes()
    assert.strictEqual(routes[0].method, 'POST')
  })

  test('registers all HTTP methods', () => {
    const router = new Router()
    router.get('/a', () => {})
    router.post('/b', () => {})
    router.put('/c', () => {})
    router.patch('/d', () => {})
    router.delete('/e', () => {})

    const routes = router.getRoutes()
    assert.strictEqual(routes.length, 5)
    assert.deepStrictEqual(
      routes.map(r => r.method),
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    )
  })

  test('normalizes paths', () => {
    const router = new Router()
    router.get('users', () => {}) // no leading slash
    router.get('/posts/', () => {}) // trailing slash

    const routes = router.getRoutes()
    assert.strictEqual(routes[0].path, '/users')
    assert.strictEqual(routes[1].path, '/posts')
  })

  test('handles route with middleware', () => {
    const router = new Router()
    const auth = () => {}
    const logger = () => {}
    const handler = () => {}

    router.get('/protected', auth, logger, handler)

    const routes = router.getRoutes()
    assert.strictEqual(routes[0].middlewareCount, 2)
  })

  test('handles named routes', () => {
    const router = new Router()
    router.get('/users/:id', 'users.show', () => {})

    assert.strictEqual(router.route('users.show', { id: 42 }), '/users/42')
  })

  test('throws on unknown named route', () => {
    const router = new Router()

    assert.throws(() => {
      router.route('unknown')
    }, /Route 'unknown' not found/)
  })

  test('creates route groups with prefix', () => {
    const router = new Router()

    router.group('/api', (group) => {
      group.get('/users', () => {})
      group.get('/posts', () => {})
    })

    const routes = router.getRoutes()
    assert.strictEqual(routes.length, 2)
    assert.strictEqual(routes[0].path, '/api/users')
    assert.strictEqual(routes[1].path, '/api/posts')
  })

  test('creates route groups with middleware', () => {
    const router = new Router()
    const auth = () => {}

    router.group('/admin', auth, (group) => {
      group.get('/dashboard', () => {})
    })

    const routes = router.getRoutes()
    assert.strictEqual(routes[0].middlewareCount, 1)
  })

  test('nests route groups', () => {
    const router = new Router()

    router.group('/api', (api) => {
      api.group('/v1', (v1) => {
        v1.get('/users', () => {})
      })
    })

    const routes = router.getRoutes()
    assert.strictEqual(routes[0].path, '/api/v1/users')
  })

  test('matches routes correctly', () => {
    const router = new Router()
    router.get('/users', () => {})
    router.get('/users/:id', () => {})
    router.post('/users', () => {})

    const match1 = router.match('GET', '/users')
    assert.ok(match1)
    assert.strictEqual(match1.route.path, '/users')

    const match2 = router.match('GET', '/users/123')
    assert.ok(match2)
    assert.strictEqual(match2.route.path, '/users/:id')
    assert.strictEqual(match2.params.id, '123')

    const match3 = router.match('POST', '/users')
    assert.ok(match3)
    assert.strictEqual(match3.route.method, 'POST')

    const noMatch = router.match('DELETE', '/users')
    assert.strictEqual(noMatch, null)
  })

  test('resource() creates CRUD routes', () => {
    const router = new Router()
    const controller = {
      index: () => {},
      show: () => {},
      create: () => {},
      update: () => {},
      destroy: () => {}
    }

    router.resource('/posts', controller)

    const routes = router.getRoutes()
    assert.strictEqual(routes.length, 5)

    const methods = routes.map(r => `${r.method} ${r.path}`)
    assert.ok(methods.includes('GET /posts'))
    assert.ok(methods.includes('GET /posts/:id'))
    assert.ok(methods.includes('POST /posts'))
    assert.ok(methods.includes('PUT /posts/:id'))
    assert.ok(methods.includes('DELETE /posts/:id'))
  })

  test('resource() generates named routes', () => {
    const router = new Router()
    const controller = {
      index: () => {},
      show: () => {}
    }

    router.resource('/articles', controller, { only: ['index', 'show'] })

    assert.strictEqual(router.route('articles.index'), '/articles')
    assert.strictEqual(router.route('articles.show', { id: 5 }), '/articles/5')
  })

  test('resource() respects only option', () => {
    const router = new Router()
    const controller = {
      index: () => {},
      show: () => {},
      create: () => {},
      update: () => {},
      destroy: () => {}
    }

    router.resource('/users', controller, { only: ['index', 'show'] })

    const routes = router.getRoutes()
    assert.strictEqual(routes.length, 2)
  })

  test('use() adds global middleware', () => {
    const router = new Router()
    const logger = () => {}

    router.use(logger)
    router.get('/test', () => {})

    const routes = router.getRoutes()
    assert.strictEqual(routes[0].middlewareCount, 1)
  })

  test('all() registers for all methods', () => {
    const router = new Router()
    router.all('/wildcard', () => {})

    const routes = router.getRoutes()
    assert.strictEqual(routes.length, 7) // get, post, put, patch, delete, head, options
  })
})

describe('createRouter', () => {
  test('creates router with options', () => {
    const router = createRouter({ prefix: '/api' })
    router.get('/users', () => {})

    const routes = router.getRoutes()
    assert.strictEqual(routes[0].path, '/api/users')
  })
})

describe('route names among middleware', () => {
  const mw = (req, res, next) => next()
  const handler = () => {}

  test('picks up a name given before the middleware', () => {
    const router = new Router()
    router.get('/posts', 'posts.index', mw, handler)

    assert.strictEqual(router.routes[0].name, 'posts.index')
  })

  test('picks up a name given after the middleware', () => {
    const router = new Router()
    router.get('/posts/:id', mw, 'posts.show', handler)

    assert.strictEqual(router.routes[0].name, 'posts.show')
  })

  test('never leaves the name in the middleware chain', () => {
    const router = new Router()
    router.get('/posts/:id', mw, 'posts.show', handler)

    // A string left in the chain is later called as middleware and throws
    // "fn is not a function" at request time.
    const allCallable = router.routes[0].middleware.every(m => typeof m === 'function')
    assert.ok(allCallable)
  })

  test('resource routes carry names and callable middleware', () => {
    const router = new Router()
    const controller = { index: handler, show: handler, create: handler, update: handler, destroy: handler }
    router.resource('/posts', controller, { middleware: [mw] })

    assert.strictEqual(router.routes.length, 5)
    for (const route of router.routes) {
      assert.ok(route.name, 'every resource route should be named')
      assert.ok(route.middleware.every(m => typeof m === 'function'))
      assert.strictEqual(typeof route.handler, 'function')
    }
  })

  test('named resource routes generate URLs', () => {
    const router = new Router()
    router.resource('/posts', { show: handler }, { middleware: [mw], name: 'posts' })

    assert.strictEqual(router.route('posts.show', { id: 42 }), '/posts/42')
  })
})

describe('route names among middleware, end to end', () => {
  // The checks above read the router's own arrays. These serve real requests,
  // because the failure was only visible at request time: applyTo() wraps every
  // middleware entry in wrapAsync, so a name left in the chain became a call of
  // a string and answered 500 "fn is not a function".

  /** Serve `router` on an ephemeral port. */
  async function serve(router) {
    const app = createApp()
    router.applyTo(app)

    await new Promise(resolve => app.listen(0, resolve))

    return {
      url: `http://127.0.0.1:${app.server.address().port}`,
      close: () => new Promise(resolve => app.close(resolve))
    }
  }

  function sendJson(res, body) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  const controller = {
    index: (req, res) => sendJson(res, { action: 'index' }),
    show: (req, res) => sendJson(res, { action: 'show', id: req.params.id })
  }

  test('resource() with middleware answers 200 and runs the middleware', async () => {
    const seen = []
    const router = new Router()
    router.resource('/posts', controller, {
      only: ['index', 'show'],
      middleware: [(req, res, next) => { seen.push(req.path); next() }]
    })

    const server = await serve(router)
    try {
      const index = await fetch(`${server.url}/posts`)
      assert.strictEqual(index.status, 200)
      assert.deepStrictEqual(await index.json(), { action: 'index' })

      const show = await fetch(`${server.url}/posts/42`)
      assert.strictEqual(show.status, 200)
      assert.deepStrictEqual(await show.json(), { action: 'show', id: '42' })
    } finally {
      await server.close()
    }

    assert.deepStrictEqual(seen, ['/posts', '/posts/42'], 'middleware should run for each route')

    // The name has to survive too — it was dropped along with the 500.
    assert.strictEqual(router.route('posts.index'), '/posts')
    assert.strictEqual(router.route('posts.show', { id: 42 }), '/posts/42')
  })

  test('a name written after middleware answers 200', async () => {
    const router = new Router()
    router.get('/posts/:id', (req, res, next) => next(), 'posts.show', controller.show)

    const server = await serve(router)
    try {
      const res = await fetch(`${server.url}/posts/7`)
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(await res.json(), { action: 'show', id: '7' })
    } finally {
      await server.close()
    }

    assert.strictEqual(router.route('posts.show', { id: 7 }), '/posts/7')
  })
})
