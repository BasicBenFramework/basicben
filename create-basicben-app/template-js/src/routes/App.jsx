import { createClientApp } from '@basicbenframework/core/client'
import { AppLayout } from '../client/layouts/AppLayout'
import { AuthLayout } from '../client/layouts/AuthLayout'
import { DocsLayout } from '../client/layouts/DocsLayout'
import { Home } from '../client/pages/Home'
import { Auth } from '../client/pages/Auth'
import { Feed } from '../client/pages/Feed'
import { FeedPost } from '../client/pages/FeedPost'
import { Posts } from '../client/pages/Posts'
import { PostForm } from '../client/pages/PostForm'
import { Profile } from '../client/pages/Profile'
import { GettingStarted } from '../client/pages/GettingStarted'
import { Database } from '../client/pages/Database'
import { Routing } from '../client/pages/Routing'
import { Authentication } from '../client/pages/Authentication'
import { Validation } from '../client/pages/Validation'
import { Content } from '../client/pages/Content'
import { Storage } from '../client/pages/Storage'
import { Plugins } from '../client/pages/Plugins'
import { Testing } from '../client/pages/Testing'

export default createClientApp({
  layout: AppLayout,
  routes: {
    '/': Home,
    '/login': { component: Auth, layout: AuthLayout, guest: true },
    '/register': { component: Auth, layout: AuthLayout, guest: true },
    '/feed': Feed,
    '/feed/:id': FeedPost,
    '/posts': { component: Posts, auth: true },
    '/posts/new': { component: PostForm, auth: true },
    '/posts/:id/edit': { component: PostForm, auth: true },
    '/profile': { component: Profile, auth: true },
    '/docs': { component: GettingStarted, layout: DocsLayout },
    '/docs/routing': { component: Routing, layout: DocsLayout },
    '/docs/database': { component: Database, layout: DocsLayout },
    '/docs/authentication': { component: Authentication, layout: DocsLayout },
    '/docs/validation': { component: Validation, layout: DocsLayout },
    '/docs/content': { component: Content, layout: DocsLayout },
    '/docs/storage': { component: Storage, layout: DocsLayout },
    '/docs/plugins': { component: Plugins, layout: DocsLayout },
    '/docs/testing': { component: Testing, layout: DocsLayout },
  }
})
