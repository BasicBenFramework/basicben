/**
 * Users seeder
 * Creates sample users for development/testing
 */

import { db } from '@basicbenframework/core/db'
import { hashPassword } from '@basicbenframework/core/auth'
import { ROLES, DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'

export async function seed() {
  const password = await hashPassword('password123')

  // Set the role explicitly. The column defaults to 'subscriber', and the
  // migration that promotes the first account runs before this seeder, when
  // the table is still empty — so an admin created here has to say so.
  await (await db.table('users'))
    .insert({
      name: 'Admin User',
      email: 'admin@example.com',
      password,
      role: ROLES.ADMIN
    })

  // Create test user
  await (await db.table('users'))
    .insert({
      name: 'Test User',
      email: 'test@example.com',
      password,
      role: DEFAULT_ROLE
    })

  console.log('Seeded 2 users (password: password123)')
}
