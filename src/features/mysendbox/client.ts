/**
 * A small client for MySendbox's REST API (https://api.mysendbox.com/v1).
 *
 * Only the calls this feature makes. Every call answers a result rather than
 * throwing, so callers decide what a failure means: a 4xx is MySendbox saying
 * no (not worth retrying until something changes), a 5xx, 429 or network
 * error is MySendbox being unavailable (retry later).
 *
 * `fetch` and the base URL are injectable, so tests run against a fake.
 */

export type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string; retry: boolean }

export interface ContactRecord {
  id: string
  email: string
  status: 'subscribed' | 'pending' | 'unsubscribed' | 'bounced' | 'complained' | 'cleaned'
  attributes?: Record<string, unknown>
  audienceIds?: string[]
}

export interface BroadcastRecord {
  id: string
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'canceled'
  stats?: Record<string, number | boolean>
}

export interface ClientOptions {
  apiKey: string
  baseUrl?: string
  fetch?: typeof fetch
}

export const DEFAULT_BASE_URL = 'https://api.mysendbox.com/v1'

export function createClient({ apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = fetch }: ClientOptions) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
    let res: Response
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      })
    } catch (err) {
      return { ok: false, status: 0, error: `MySendbox could not be reached: ${(err as Error)?.message ?? err}`, retry: true }
    }

    const text = await res.text().catch(() => '')
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }

    if (res.ok) return { ok: true, status: res.status, data: data as T }

    const error = String(data?.error ?? data?.message ?? (text.slice(0, 200) || `HTTP ${res.status}`)).slice(0, 500)
    return { ok: false, status: res.status, error, code: data?.code ?? data?.error_code, retry: res.status >= 500 || res.status === 429 }
  }

  const enc = encodeURIComponent

  return {
    createAudience: (name: string) => call<{ id: string; name: string }>('POST', '/audiences', { name }),
    listAudiences: () => call<{ audiences: Array<{ id: string; name: string }> }>('GET', '/audiences'),

    /** Add or update by email. 201 new, 200 existing; 409 for someone who unsubscribed or was erased. */
    upsertContact: (contact: {
      email: string
      name?: string | null
      audienceIds?: string[]
      attributes?: Record<string, unknown>
      consent: string
      confirmed: boolean
    }) => call<ContactRecord>('POST', '/contacts', contact),

    unsubscribeContact: (id: string, note?: string) =>
      call<unknown>('POST', `/contacts/${enc(id)}/unsubscribe`, note ? { note } : {}),

    eraseContact: (id: string) => call<{ deleted: boolean }>('DELETE', `/contacts/${enc(id)}`),

    /** A signup form's double opt-in: MySendbox sends the confirmation mail. */
    subscribeThroughForm: (formId: string, person: { email: string; name?: string | null }) =>
      call<{ contact?: ContactRecord; confirmationSent?: boolean }>('POST', `/forms/${enc(formId)}/subscribe`, person),

    listContacts: (query: Record<string, string | undefined>) => {
      const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][])
      return call<{ contacts: ContactRecord[]; next: string | null }>('GET', `/contacts?${params}`)
    },

    createBroadcast: (broadcast: {
      name: string
      subject: string
      preheader?: string | null
      html: string
      text?: string | null
      audienceId?: string | null
      fromAddress?: string | null
      fromName?: string | null
      replyTo?: string | null
    }) => call<BroadcastRecord>('POST', '/broadcasts', broadcast),

    scheduleNow: (id: string) => call<BroadcastRecord>('POST', `/broadcasts/${enc(id)}/schedule`, {}),

    getBroadcast: (id: string) => call<BroadcastRecord>('GET', `/broadcasts/${enc(id)}`),

    sendableCount: (audienceId: string) =>
      call<{ total: number; subscribed: number; sendable: number }>('GET', `/segments/count?audience=${enc(audienceId)}`)
  }
}

export type MySendboxClient = ReturnType<typeof createClient>
