#!/usr/bin/env node

import { parseArgs } from '../src/cli/parser.js'
import { dispatch } from '../src/cli/dispatcher.js'
import { loadEnv } from '../src/cli/env.js'

// Before dispatch, so every command sees the same configuration. Only `dev` and
// `start` used to read .env, which meant `basicben migrate` connected to the
// SQLite default while the server it started connected to whatever DATABASE_URL
// in .env named — two databases, both reporting success.
loadEnv()

const { command, args, flags } = parseArgs(process.argv.slice(2))

dispatch(command, args, flags)
