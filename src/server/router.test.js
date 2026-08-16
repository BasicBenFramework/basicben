/**
 * Tests for the Router class
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { Router, createRouter } from './router.js'

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
