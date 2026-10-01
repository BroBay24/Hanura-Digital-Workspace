import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireAuthenticated } from './authorization-guards.ts'

export const getCurrentPrincipal = createServerFn({ method: 'GET' }).handler(
  async () => {
    setResponseHeader('cache-control', 'private, no-store')
    const request = getRequest()
    const result = await requireAuthenticated(request)
    if (result.ok)
      return { principal: result.principal, hadSessionCookie: true }
    if (result.response.status === 401) {
      return {
        principal: null,
        hadSessionCookie:
          request.headers.get('cookie')?.includes('session_token=') ?? false,
      }
    }
    throw new Error('Layanan autentikasi sedang bermasalah.')
  },
)
