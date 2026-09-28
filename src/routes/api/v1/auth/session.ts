import { createFileRoute } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/lib/auth-contract'
import {
  callNativeAuth,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  safeJson,
} from '#/lib/auth-contract'

export const sessionHandler = async ({ request }: AuthRouteContext) => {
  const nativeResponse = await callNativeAuth(request, '/api/auth/get-session')
  const nativeBody = await safeJson(nativeResponse)

  if (nativeResponse.status >= 500) {
    return errorResponse(
      request,
      500,
      'INTERNAL_ERROR',
      'Layanan autentikasi sedang bermasalah.',
      undefined,
      nativeResponse.headers,
    )
  }

  if (
    !nativeResponse.ok ||
    !nativeBody ||
    typeof nativeBody.user !== 'object' ||
    typeof nativeBody.session !== 'object' ||
    nativeBody.user === null ||
    nativeBody.session === null
  ) {
    return jsonResponse(
      {
        data: {
          authenticated: false,
          user: null,
          session: null,
        },
      },
      200,
      nativeResponse.headers,
    )
  }

  const nativeUser = nativeBody.user as Record<string, unknown>
  const nativeSession = nativeBody.session as Record<string, unknown>

  return jsonResponse(
    {
      data: {
        authenticated: true,
        user: {
          id: nativeUser.id,
          email: nativeUser.email,
          name: nativeUser.name,
        },
        session: {
          expiresAt:
            nativeSession.expiresAt instanceof Date
              ? nativeSession.expiresAt.toISOString()
              : nativeSession.expiresAt,
        },
      },
    },
    200,
    nativeResponse.headers,
  )
}

export const Route = createFileRoute('/api/v1/auth/session')({
  server: {
    handlers: {
      GET: sessionHandler,
      ANY: methodNotAllowed('GET, HEAD'),
    },
  },
})
