/**
 * Posts seeder
 * Creates sample blog posts for development/testing
 */

import { db } from '@basicbenframework/core/db'

export async function seed() {
  // Get the first user (admin)
  const user = await (await db.table('users')).first()

  if (!user) {
    console.log('No users found. Run users seed first.')
    return
  }

  const posts = [
    {
      user_id: user.id,
      title: 'Welcome to BasicBen',
      content: 'This is your first blog post. BasicBen makes it easy to build full-stack React applications with minimal dependencies.',
      published: 1
    },
    {
      user_id: user.id,
      title: 'Getting Started with Migrations',
      content: 'Migrations help you version control your database schema. Run `basicben make:migration` to create a new migration.',
      published: 1
    },
    {
      user_id: user.id,
      title: 'Draft Post Example',
      content: 'This is a draft post that is not yet published.',
      published: 0
    }
  ]

  for (const post of posts) {
    await (await db.table('posts')).insert(post)
  }

  console.log(`Seeded ${posts.length} posts`)
}
