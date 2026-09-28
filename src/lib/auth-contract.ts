import { splitSetCookieHeader } from 'better-auth/cookies'
import { z } from 'zod'
import { auth } from './auth.ts'

const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

export const loginRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
})

export type AuthRouteContext = { request: Request }

type ErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INTERNAL_ERROR'
  | 'METHOD_NOT_ALLOWED'
  | 'TOO_MANY_REQUESTS'

export const correlationIdFor = (request: Request) => {
  const provided = request.headers.get('x-correlation-id')
  return provided && correlationIdPattern.test(provided)
    ? provided
    : crypto.randomUUID()
}

const setCookies = (headers: Headers) => {
  const cookies = headers.getSetCookie()
  return cookies.length > 0
    ? cookies
    : splitSetCookieHeader(headers.get('set-cookie') ?? '')
}

const responseHeaders = (source?: Headers) => {
  const headers = new Headers({
    'cache-control': 'no-store',
    pragma: 'no-cache',
  })

  if (source) {
    for (const cookie of setCookies(source)) {
      headers.append('set-cookie', cookie)
    }
  }

  return headers
}

export const jsonResponse = (
  body: unknown,
  status = 200,
  sourceHeaders?: Headers,
) =>
  Response.json(body, {
    status,
    headers: responseHeaders(sourceHeaders),
  })

export const errorResponse = (
  request: Request,
  status: number,
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, Array<string>>,
  sourceHeaders?: Headers,
) => {
  const error = {
    code,
    message,
    correlationId: correlationIdFor(request),
    ...(fieldErrors ? { fieldErrors } : {}),
  }
  return jsonResponse({ error }, status, sourceHeaders)
}

export const methodNotAllowed = (allowed: string) => () =>
  new Response(
    JSON.stringify({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Metode tidak didukung.',
        correlationId: crypto.randomUUID(),
      },
    }),
    {
      status: 405,
      headers: {
        allow: allowed,
        'cache-control': 'no-store',
        'content-type': 'application/json',
        pragma: 'no-cache',
      },
    },
  )

export const nativeAuthRequest = (
  request: Request,
  path: string,
  body?: unknown,
) => {
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  headers.delete('host')

  if (body !== undefined) {
    headers.set('content-type', 'application/json')
  }

  return new Request(new URL(path, request.url), {
    method: request.method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: request.signal,
  })
}

export const callNativeAuth = (
  request: Request,
  path: string,
  body?: unknown,
) => auth.handler(nativeAuthRequest(request, path, body))

export const safeJson = async (response: Response) => {
  try {
    return (await response.json()) as Record<string, unknown> | null
  } catch {
    return null
  }
}

export const loginErrorResponse = (
  request: Request,
  nativeResponse: Response,
) => {
  if (nativeResponse.status === 429) {
    return errorResponse(
      request,
      429,
      'TOO_MANY_REQUESTS',
      'Terlalu banyak percobaan. Coba lagi nanti.',
      undefined,
      nativeResponse.headers,
    )
  }

  if (nativeResponse.status >= 400 && nativeResponse.status < 500) {
    return errorResponse(
      request,
      401,
      'INVALID_CREDENTIALS',
      'Email atau kata sandi tidak valid.',
      undefined,
      nativeResponse.headers,
    )
  }

  return errorResponse(
    request,
    500,
    'INTERNAL_ERROR',
    'Layanan autentikasi sedang bermasalah.',
    undefined,
    nativeResponse.headers,
  )
}
