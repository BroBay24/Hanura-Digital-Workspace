import type { AuthorizationContext, PermissionCode } from './authorization.ts'
import { resolveAuthorizationContext } from './authorization.ts'
import { auth } from './auth.ts'
import { correlationIdFor, errorResponse } from './auth-contract.ts'

export type AuthenticatedPrincipal = {
  user: {
    id: string
    email: string
    name: string
  }
  session: { expiresAt: string }
  authorization: AuthorizationContext
}

export type AuthorizationGuardResult =
  | { ok: true; principal: AuthenticatedPrincipal }
  | { ok: false; response: Response }

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>

type GuardDependencies = {
  getSession: (headers: Headers) => Promise<SessionResult>
  resolveAuthorization: typeof resolveAuthorizationContext
  logFailure: (event: {
    correlationId: string
    stage: 'session_lookup' | 'rbac_resolution'
  }) => void
}

const defaultDependencies: GuardDependencies = {
  getSession: (headers) =>
    auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    }),
  resolveAuthorization: resolveAuthorizationContext,
  logFailure: (event) => console.error('Authorization guard failed', event),
}

const internalError = (
  request: Request,
  correlationId: string,
  dependencies: GuardDependencies,
  stage: 'session_lookup' | 'rbac_resolution',
) => {
  dependencies.logFailure({ correlationId, stage })
  return {
    ok: false as const,
    response: errorResponse(
      request,
      500,
      'INTERNAL_ERROR',
      'Layanan autentikasi sedang bermasalah.',
      undefined,
      undefined,
      correlationId,
    ),
  }
}

export const createAuthorizationGuards = (
  dependencies: GuardDependencies = defaultDependencies,
) => {
  const requireAuthenticated = async (
    request: Request,
  ): Promise<AuthorizationGuardResult> => {
    const correlationId = correlationIdFor(request)

    let authenticated: SessionResult
    try {
      authenticated = await dependencies.getSession(request.headers)
    } catch {
      return internalError(
        request,
        correlationId,
        dependencies,
        'session_lookup',
      )
    }

    if (!authenticated) {
      return {
        ok: false,
        response: errorResponse(
          request,
          401,
          'UNAUTHENTICATED',
          'Autentikasi diperlukan.',
          undefined,
          undefined,
          correlationId,
        ),
      }
    }

    if (
      typeof authenticated.user.id !== 'string' ||
      authenticated.user.id.length === 0 ||
      authenticated.session.userId !== authenticated.user.id
    ) {
      return internalError(
        request,
        correlationId,
        dependencies,
        'session_lookup',
      )
    }

    let authorization: AuthorizationContext
    try {
      authorization = await dependencies.resolveAuthorization(
        authenticated.user.id,
      )
    } catch {
      return internalError(
        request,
        correlationId,
        dependencies,
        'rbac_resolution',
      )
    }

    return {
      ok: true,
      principal: {
        user: {
          id: authenticated.user.id,
          email: authenticated.user.email,
          name: authenticated.user.name,
        },
        session: {
          expiresAt:
            authenticated.session.expiresAt instanceof Date
              ? authenticated.session.expiresAt.toISOString()
              : String(authenticated.session.expiresAt),
        },
        authorization,
      },
    }
  }

  const requirePermission =
    (permission: PermissionCode) =>
    async (request: Request): Promise<AuthorizationGuardResult> => {
      const authenticated = await requireAuthenticated(request)
      if (!authenticated.ok) {
        return authenticated
      }

      if (
        !authenticated.principal.authorization.permissions.includes(permission)
      ) {
        return {
          ok: false,
          response: errorResponse(request, 403, 'FORBIDDEN', 'Akses ditolak.'),
        }
      }

      return authenticated
    }

  return { requireAuthenticated, requirePermission }
}

export const { requireAuthenticated, requirePermission } =
  createAuthorizationGuards()
