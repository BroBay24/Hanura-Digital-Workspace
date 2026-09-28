import { createFileRoute } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/lib/auth-contract'
import {
  callNativeAuth,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from '#/lib/auth-contract'

export const logoutHandler = async ({ request }: AuthRouteContext) => {
  const nativeResponse = await callNativeAuth(request, '/api/auth/sign-out', {})

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

  return jsonResponse(
    { data: { authenticated: false } },
    200,
    nativeResponse.headers,
  )
}

export const Route = createFileRoute('/api/v1/auth/logout')({
  server: {
    handlers: {
      POST: logoutHandler,
      ANY: methodNotAllowed('POST'),
    },
  },
})
