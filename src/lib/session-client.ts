import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

export type SafeUser = {
  id: string
  email: string
  name: string
}

export type AuthorizationSummary = {
  roles: Array<string>
  permissions: Array<string>
}

export type AuthenticatedSession = {
  data: {
    authenticated: true
    user: SafeUser
    session: { expiresAt: string }
    authorization: AuthorizationSummary
  }
}

export type UnauthenticatedSession = {
  data: {
    authenticated: false
    user: null
    session: null
    authorization: null
  }
}

export type AuthSession = AuthenticatedSession | UnauthenticatedSession

type AuthErrorBody = {
  error?: {
    code?: string
    message?: string
    fieldErrors?: Partial<Record<'email' | 'password', Array<string>>>
    correlationId?: string
  }
}

export class AuthApiError extends Error {
  status: number
  code: string
  fieldErrors?: Partial<Record<'email' | 'password', Array<string>>>
  correlationId?: string

  constructor(status: number, body: AuthErrorBody) {
    super(body.error?.message ?? 'Layanan autentikasi sedang bermasalah.')
    this.name = 'AuthApiError'
    this.status = status
    this.code = body.error?.code ?? 'INTERNAL_ERROR'
    this.fieldErrors = body.error?.fieldErrors
    this.correlationId = body.error?.correlationId
  }
}

export const authSessionQueryKey = ['auth', 'session'] as const

const safeUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
})

const authSessionSchema = z.discriminatedUnion('authenticated', [
  z.object({
    authenticated: z.literal(true),
    user: safeUserSchema,
    session: z.object({ expiresAt: z.string() }),
    authorization: z.object({
      roles: z.array(z.string()),
      permissions: z.array(z.string()),
    }),
  }),
  z.object({
    authenticated: z.literal(false),
    user: z.null(),
    session: z.null(),
    authorization: z.null(),
  }),
])

const responseBody = async <T>(response: Response): Promise<T> => {
  const body = (await response.json()) as T & AuthErrorBody
  if (!response.ok) {
    throw new AuthApiError(response.status, body)
  }
  return body
}

export const fetchAuthSession = async (
  fetcher: typeof fetch = fetch,
): Promise<AuthSession> => {
  const body = await responseBody<{ data: unknown }>(
    await fetcher('/api/v1/auth/session', {
      credentials: 'include',
      headers: { accept: 'application/json' },
    }),
  )
  return { data: authSessionSchema.parse(body.data) } as AuthSession
}

export const loginWithPassword = async (
  input: { email: string; password: string },
  fetcher: typeof fetch = fetch,
) =>
  responseBody<{ data: { authenticated: true; user: SafeUser } }>(
    await fetcher('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }),
  )

export const logoutCurrentSession = async (fetcher: typeof fetch = fetch) => {
  const response = await fetcher('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    return responseBody<{ data: { authenticated: false } }>(response)
  }
  return { data: { authenticated: false as const } }
}

export const useAuthSession = () =>
  useQuery({
    queryKey: authSessionQueryKey,
    queryFn: () => fetchAuthSession(),
    enabled: typeof window !== 'undefined',
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.data.authenticated ? 60_000 : false,
    staleTime: 30_000,
  })

export const hasPermission = (
  session: AuthSession | undefined,
  permission: string,
) =>
  session?.data.authenticated === true &&
  session.data.authorization.permissions.includes(permission)

export const postLoginDestination = '/'

export const loginReasonForLostSession = (wasAuthenticated: boolean) =>
  wasAuthenticated ? ('session-expired' as const) : undefined
