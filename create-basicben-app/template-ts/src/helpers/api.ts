interface ApiOptions extends RequestInit {
  headers?: Record<string, string>
}

interface ApiError {
  error?: string
  errors?: Record<string, string[]>
}

interface Api {
  <T = unknown>(path: string, options?: ApiOptions): Promise<T>
  get<T = unknown>(path: string, options?: ApiOptions): Promise<T>
  post<T = unknown>(path: string, body?: unknown, options?: ApiOptions): Promise<T>
  put<T = unknown>(path: string, body?: unknown, options?: ApiOptions): Promise<T>
  patch<T = unknown>(path: string, body?: unknown, options?: ApiOptions): Promise<T>
  delete<T = unknown>(path: string, options?: ApiOptions): Promise<T>
}

const request = async <T = unknown>(path: string, options: ApiOptions = {}): Promise<T> => {
  const token = localStorage.getItem('token')
  let res: Response
  try {
    res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    })
  } catch {
    throw new Error('Unable to connect to server')
  }
  let data: T & ApiError
  try {
    data = await res.json()
  } catch {
    throw new Error(res.ok ? 'Invalid response from server' : `Server error (${res.status})`)
  }
  if (!res.ok) {
    const errorValues = data.errors ? Object.values(data.errors) : []
    const firstError = errorValues[0]?.[0]
    throw new Error(data.error || firstError || 'Request failed')
  }
  return data
}

/**
 * The verb helpers every admin page calls.
 *
 * These were being used throughout the admin without existing, so every page
 * that loaded one threw `api.get is not a function` before it rendered. The
 * type checker had been reporting it as 48 separate errors.
 */
export const api: Api = Object.assign(request, {
  get: <T = unknown>(path: string, options: ApiOptions = {}) =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T = unknown>(path: string, body?: unknown, options: ApiOptions = {}) =>
    request<T>(path, { ...options, method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),

  put: <T = unknown>(path: string, body?: unknown, options: ApiOptions = {}) =>
    request<T>(path, { ...options, method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),

  patch: <T = unknown>(path: string, body?: unknown, options: ApiOptions = {}) =>
    request<T>(path, { ...options, method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),

  delete: <T = unknown>(path: string, options: ApiOptions = {}) =>
    request<T>(path, { ...options, method: 'DELETE' })
})
