/**
 * The request and response as the site's own controllers and middleware see
 * them. `basicben make:controller` and `make:middleware` import these.
 */
export interface Request {
  body: Record<string, unknown>
  params: Record<string, string>
  query: Record<string, string>
  headers: Record<string, string>
  userId?: number
  user?: { id: number; name: string; email: string; role: string }
}

export interface Response {
  json: (data: unknown, status?: number) => void
  status: (code: number) => Response
  send: (body?: string) => void
  redirect: (url: string, status?: number) => void
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}
