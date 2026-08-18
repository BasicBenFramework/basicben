/**
 * Turso / libSQL adapter.
 *
 * Speaks Hrana 3 over HTTP (`POST /v3/pipeline`) with `fetch`, so it needs no
 * client library. The wire format is JSON with explicitly tagged values, and
 * the tagging is the part that matters: **integers travel as strings**, because
 * JSON numbers are doubles and a 64-bit rowid does not survive one. Decoding
 * them back to numbers is this adapter's main job.
 *
 * Streams and batons: HTTP is stateless, so libSQL tracks per-stream state with
 * a baton handed back on each response. A standalone query opens a stream and
 * closes it in the same round trip. A transaction has to hold its baton for the
 * duration, since that is the only thing tying BEGIN and COMMIT together.
 */

const PIPELINE_PATH = '/v3/pipeline'

/**
 * Create the Turso adapter.
 *
 * @param {string} url - libsql://, https:// or http:// URL
 * @param {Object} options
 * @param {string} [options.authToken] - defaults to TURSO_AUTH_TOKEN
 * @param {number} [options.timeout] - per-request timeout in ms
 * @param {typeof fetch} [options.fetch] - injectable for tests
 */
export async function createTursoAdapter(url, options = {}) {
  const endpoint = toHttpUrl(url)
  const authToken = options.authToken || process.env.TURSO_AUTH_TOKEN || ''
  const timeout = options.timeout ?? 15000
  const doFetch = options.fetch || globalThis.fetch

  if (!doFetch) {
    throw new Error('Turso adapter requires a fetch implementation (Node 18+)')
  }

  // A local sqld usually runs without auth; a hosted Turso database never does.
  if (!authToken && /turso\.io$/i.test(new URL(endpoint).hostname)) {
    throw new Error(
      'Turso requires an auth token. Set TURSO_AUTH_TOKEN, or pass authToken in the db config.'
    )
  }

  /**
   * Send a pipeline request and return its stream results.
   *
   * @param {Array<Object>} requests
   * @param {string|null} baton
   * @returns {Promise<{ results: Array<Object>, baton: string|null }>}
   */
  async function pipeline(requests, baton = null) {
    const controller = new AbortController()
    const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null

    let response
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({ baton, requests }),
        signal: controller.signal
      })
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Turso request timed out after ${timeout}ms`)
      }
      throw new Error(`Turso request failed: ${err.message}`)
    } finally {
      if (timer) clearTimeout(timer)
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Turso responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      )
    }

    const payload = await response.json()

    // Each request gets its own result, and a failure anywhere in the pipeline
    // is reported per-result rather than as an HTTP error.
    for (const result of payload.results || []) {
      if (result?.type === 'error') {
        const error = new Error(result.error?.message || 'Unknown Turso error')
        if (result.error?.code) error.code = result.error.code
        throw error
      }
    }

    return { results: payload.results || [], baton: payload.baton ?? null }
  }

  /**
   * Run one statement on its own stream, closing it in the same round trip.
   */
  async function executeOnce(sql, params, wantRows) {
    const { results } = await pipeline([
      { type: 'execute', stmt: buildStmt(sql, params, wantRows) },
      { type: 'close' }
    ])
    return results[0].response.result
  }

  /**
   * Build the adapter surface. `send` decides which stream the statements run
   * on, which is the only difference between the connection and a transaction.
   */
  function surface(send) {
    return {
      driver: 'turso',

      async run(sql, params = []) {
        const result = await send(sql, params, false)
        return {
          lastInsertRowid: result.last_insert_rowid == null
            ? null
            : toNumber(result.last_insert_rowid),
          changes: Number(result.affected_row_count ?? 0)
        }
      },

      async get(sql, params = []) {
        const result = await send(sql, params, true)
        const rows = decodeRows(result)
        return rows[0]
      },

      async all(sql, params = []) {
        const result = await send(sql, params, true)
        return decodeRows(result)
      }
    }
  }

  const connection = surface(executeOnce)

  const adapter = {
    ...connection,

    /**
     * Execute a multi-statement script.
     *
     * Hrana's `sequence` is built for exactly this — migrations arrive as one
     * string of semicolon-separated statements. It discards result rows and
     * stops at the first failure, which is what a migration wants.
     */
    async exec(sql) {
      await pipeline([
        { type: 'sequence', sql },
        { type: 'close' }
      ])
    },

    /**
     * Run a function inside a transaction.
     *
     * The baton is what makes this work: every statement has to travel on the
     * same stream as the BEGIN, or it lands outside the transaction entirely.
     * The callback receives a transaction-scoped adapter, matching the SQLite
     * and Postgres adapters so the same code ports between drivers.
     */
    async transaction(fn) {
      let baton = null

      const begin = await pipeline([{ type: 'execute', stmt: buildStmt('BEGIN', [], false) }])
      baton = begin.baton

      // Statements inside the transaction reuse the baton and must be
      // serialized — libSQL rejects overlapping requests on one stream.
      const sendInTx = async (sql, params, wantRows) => {
        const { results, baton: next } = await pipeline(
          [{ type: 'execute', stmt: buildStmt(sql, params, wantRows) }],
          baton
        )
        baton = next
        return results[0].response.result
      }

      // `surface` covers run/get/all. The other two live on the connection
      // object, so a transaction-scoped adapter built from `surface` alone is
      // missing them — which went unnoticed until migrations started running
      // inside a transaction and every `db.exec` in one threw
      // "db.exec is not a function".
      const tx = {
        ...surface(sendInTx),

        /**
         * Multi-statement script, on this transaction's stream.
         *
         * The connection-level `exec` sends a `close` alongside the sequence;
         * doing that here would end the stream the transaction lives on, and
         * the COMMIT would have nowhere to go.
         */
        async exec(sql) {
          const { baton: next } = await pipeline([{ type: 'sequence', sql }], baton)
          baton = next
        },

        /** Joins the open transaction rather than starting a second one. */
        async transaction(inner) {
          return inner(tx)
        }
      }

      try {
        const result = await fn(tx)
        await pipeline(
          [{ type: 'execute', stmt: buildStmt('COMMIT', [], false) }, { type: 'close' }],
          baton
        )
        return result
      } catch (error) {
        // A rollback failure must not mask the error that caused it.
        try {
          await pipeline(
            [{ type: 'execute', stmt: buildStmt('ROLLBACK', [], false) }, { type: 'close' }],
            baton
          )
        } catch {
          // ignore
        }
        throw error
      }
    },

    /**
     * No connection to close — every stream is released as it is used.
     */
    async close() {}
  }

  return adapter
}

/**
 * Normalize a libSQL URL to the HTTP endpoint.
 *
 * @param {string} url
 * @returns {string}
 */
export function toHttpUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Turso adapter requires a database URL')
  }

  let normalized = url.trim()

  // libsql:// and wss:// are the same host over HTTPS; ws:// is a local sqld.
  if (normalized.startsWith('libsql://')) normalized = `https://${normalized.slice(9)}`
  else if (normalized.startsWith('wss://')) normalized = `https://${normalized.slice(6)}`
  else if (normalized.startsWith('ws://')) normalized = `http://${normalized.slice(5)}`

  if (!/^https?:\/\//.test(normalized)) {
    throw new Error(
      `Unsupported Turso URL "${url}". Expected libsql://, https:// or http://`
    )
  }

  const parsed = new URL(normalized)

  // Respect an explicit pipeline path; otherwise append the default.
  if (parsed.pathname && parsed.pathname !== '/') {
    return parsed.toString()
  }

  parsed.pathname = PIPELINE_PATH
  return parsed.toString()
}

/**
 * Build a Hrana statement.
 */
function buildStmt(sql, params, wantRows) {
  return {
    sql,
    args: normalizeParams(params).map(encodeValue),
    want_rows: Boolean(wantRows)
  }
}

/**
 * Accept the same shapes the other adapters do.
 */
function normalizeParams(params) {
  if (Array.isArray(params)) return params
  if (params === undefined || params === null) return []
  return [params]
}

/**
 * JS value → Hrana Value.
 *
 * @param {*} value
 * @returns {Object}
 */
export function encodeValue(value) {
  if (value === null || value === undefined) {
    return { type: 'null' }
  }

  // SQLite has no boolean type and libSQL rejects one, so match the SQLite
  // adapter and store 1/0.
  if (typeof value === 'boolean') {
    return { type: 'integer', value: value ? '1' : '0' }
  }

  if (typeof value === 'bigint') {
    return { type: 'integer', value: value.toString() }
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot bind non-finite number ${value}`)
    }
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value }
  }

  if (typeof value === 'string') {
    return { type: 'text', value }
  }

  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { type: 'blob', base64: Buffer.from(value).toString('base64') }
  }

  if (value instanceof Date) {
    return { type: 'text', value: value.toISOString() }
  }

  throw new Error(`Cannot bind value of type ${typeof value} to a Turso parameter`)
}

/**
 * Hrana Value → JS value.
 *
 * @param {Object} value
 * @returns {*}
 */
export function decodeValue(value) {
  if (!value || typeof value !== 'object') return null

  switch (value.type) {
    case 'null':
      return null
    case 'integer':
      return toNumber(value.value)
    case 'float':
      return typeof value.value === 'number' ? value.value : Number(value.value)
    case 'text':
      return value.value
    case 'blob':
      return Buffer.from(value.base64 ?? '', 'base64')
    default:
      return null
  }
}

/**
 * Integers arrive as strings. Return a number when one is exact, and a BigInt
 * when it is not — silently rounding a rowid past 2^53 would be worse than
 * handing back a type the caller has to notice.
 *
 * @param {string|number} raw
 * @returns {number|bigint}
 */
function toNumber(raw) {
  const n = Number(raw)
  if (Number.isSafeInteger(n)) return n

  try {
    return BigInt(raw)
  } catch {
    return n
  }
}

/**
 * StmtResult → array of row objects keyed by column name.
 */
function decodeRows(result) {
  if (!result || !Array.isArray(result.rows)) return []

  const names = (result.cols || []).map((c, i) => c?.name ?? `column${i}`)

  return result.rows.map((row) => {
    const out = {}
    for (let i = 0; i < row.length; i++) {
      out[names[i] ?? `column${i}`] = decodeValue(row[i])
    }
    return out
  })
}
