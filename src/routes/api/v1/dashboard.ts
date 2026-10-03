import { createFileRoute } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/lib/auth-contract'
import {
  correlationIdFor,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from '#/lib/auth-contract'
import { requireAuthenticated } from '#/lib/authorization-guards'
import { dashboardReadModelSchema } from '#/lib/dashboard-contract'
import { readDashboard } from '#/lib/dashboard-service'

type Authenticator = typeof requireAuthenticated
type DashboardReader = typeof readDashboard

export const createDashboardHandler = (dependencies?: {
  authenticate?: Authenticator
  readModel?: DashboardReader
  logFailure?: (event: { correlationId: string }) => void
}) => {
  const authenticate = dependencies?.authenticate ?? requireAuthenticated
  const readModel = dependencies?.readModel ?? readDashboard
  const logFailure =
    dependencies?.logFailure ??
    ((event: { correlationId: string }) =>
      console.error('Dashboard read failed', event))

  return async function handleDashboard({ request }: AuthRouteContext) {
    const authenticated = await authenticate(request)
    if (!authenticated.ok) return authenticated.response

    const correlationId = correlationIdFor(request)
    try {
      const data = dashboardReadModelSchema.parse(
        await readModel({
          permissions: authenticated.principal.authorization.permissions,
        }),
      )
      return jsonResponse({ data })
    } catch {
      logFailure({ correlationId })
      return errorResponse(
        request,
        500,
        'INTERNAL_ERROR',
        'Dashboard tidak dapat dimuat.',
        undefined,
        undefined,
        correlationId,
      )
    }
  }
}

export const dashboardHandler = createDashboardHandler()

export const Route = createFileRoute('/api/v1/dashboard')({
  server: {
    handlers: {
      GET: dashboardHandler,
      ANY: methodNotAllowed('GET, HEAD'),
    },
  },
})
