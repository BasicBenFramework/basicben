/**
 * Default server entry point
 * Used when no custom src/server/index.js exists
 */

import { createServer } from './index.js'

const app = await createServer()
const port = process.env.PORT || 3001

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
