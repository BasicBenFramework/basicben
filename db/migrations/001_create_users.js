export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE users (
      id ${grammar.autoIncrementPrimaryKey()},
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('users'))
}
