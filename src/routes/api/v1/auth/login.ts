import { createFileRoute } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/lib/auth-contract'
import {
  callNativeAuth,
  errorResponse,
  jsonResponse,
  loginErrorResponse,
  loginRequestSchema,
  methodNotAllowed,
  safeJson,
} from '#/lib/auth-contract'

export const loginHandler = async ({ request }: AuthRouteContext) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(
      request,
      400,
      'VALIDATION_ERROR',
      'Permintaan login tidak valid.',
    )
  }

  const parsed = loginRequestSchema.safeParse(body)
  if (!parsed.success) {
    const fieldErrors: Record<string, Array<string>> = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (field === 'email') {
        fieldErrors.email = ['Email tidak valid.']
      }
      if (field === 'password') {
        fieldErrors.password = ['Kata sandi tidak valid.']
      }
    }

    return errorResponse(
      request,
      400,
      'VALIDATION_ERROR',
      'Permintaan login tidak valid.',
      fieldErrors,
    )
  }

  const nativeResponse = await callNativeAuth(
    request,
    '/api/auth/sign-in/email',
    {
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      rememberMe: true,
    },
  )

  if (!nativeResponse.ok) {
    return loginErrorResponse(request, nativeResponse)
  }

  const nativeBody = await safeJson(nativeResponse)
  const nativeUser = nativeBody?.user
  if (
    !nativeUser ||
    typeof nativeUser !== 'object' ||
    !('id' in nativeUser) ||
    typeof nativeUser.id !== 'string' ||
    !('email' in nativeUser) ||
    typeof nativeUser.email !== 'string' ||
    !('name' in nativeUser) ||
    typeof nativeUser.name !== 'string'
  ) {
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
    {
      data: {
        user: {
          id: nativeUser.id,
          email: nativeUser.email,
          name: nativeUser.name,
        },
        authenticated: true,
      },
    },
    200,
    nativeResponse.headers,
  )
}

export const Route = createFileRoute('/api/v1/auth/login')({
  server: {
    handlers: {
      POST: loginHandler,
      ANY: methodNotAllowed('POST'),
    },
  },
})
