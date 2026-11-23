/**
 * Navigation menus, edited in the admin rather than hard-coded in a theme.
 *
 * A menu is identified by its `location` — where the front end renders it:
 * `primary` (the header), `secondary` and `footer` are created here so a front
 * end can rely on them existing; an admin may add more. One menu per location,
 * which is what makes `/api/v1/navigation` a lookup rather than a query.
 *
 * An item is either a URL or a link to a post, page or category by id
 * (`target_type` + `target_id`). Linking by id is the point: rename the page
 * and the menu follows it, unpublish it and the menu stops pointing at a 404.
 * The public API resolves the id to the target's current path at read time.
 *
 * `parent_id` allows one level of nesting — a dropdown. Deeper trees are
 * refused by the controller rather than the schema; most front ends cannot
 * render a third level usefully.
 *
 * Booleans are INTEGER 0/1, as everywhere else here, so the same SQL runs on
 * SQLite, libSQL and Postgres.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE menus (
      id ${grammar.autoIncrementPrimaryKey()},
      location TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec(`
    CREATE TABLE menu_items (
      id ${grammar.autoIncrementPrimaryKey()},
      menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      url TEXT,
      target_type TEXT,
      target_id INTEGER,
      open_in_new_tab INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_menu_items_menu ON menu_items(menu_id, sort_order)')
  await db.exec('CREATE INDEX idx_menu_items_parent ON menu_items(parent_id)')
  // Finding the items that point at a piece of content.
  await db.exec('CREATE INDEX idx_menu_items_target ON menu_items(target_type, target_id)')

  await db.run(`
    INSERT INTO menus (location, name) VALUES
    ('primary', 'Primary'),
    ('secondary', 'Secondary'),
    ('footer', 'Footer')
  `)
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('menu_items'))
  await db.exec(grammar.dropTable('menus'))
}
