import { createFileRoute } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/lib/auth-contract'
import {
  correlationIdFor,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from '#/lib/auth-contract'
import { PERMISSION_CODES } from '#/lib/authorization'
import { requirePermission } from '#/lib/authorization-guards'
import {
  memberListQuerySchema,
  memberListReadModelSchema,
} from '#/lib/member-contract'
import { memberReadModelService } from '#/lib/member-service'

const memberReadGuard = requirePermission(PERMISSION_CODES.MEMBER_READ)

type MemberReadGuard = typeof memberReadGuard
type MemberListReader = typeof memberReadModelService.list

const queryInput = (url: URL) => {
  const input: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    if (key in input) return undefined
    input[key] = value
  }
  return input
}

export const createMemberListHandler = (dependencies?: {
  authorize?: MemberReadGuard
  readModel?: MemberListReader
  logFailure?: (event: { correlationId: string }) => void
}) => {
  const authorize = dependencies?.authorize ?? memberReadGuard
  const readModel = dependencies?.readModel ?? memberReadModelService.list
  const logFailure =
    dependencies?.logFailure ??
    ((event: { correlationId: string }) =>
      console.error('Member list read failed', event))

  return async function handleMemberList({ request }: AuthRouteContext) {
    const authorized = await authorize(request)
    if (!authorized.ok) return authorized.response

    const parsed = memberListQuerySchema.safeParse(
      queryInput(new URL(request.url)),
    )
    if (!parsed.success) {
      return errorResponse(
        request,
        400,
        'VALIDATION_ERROR',
        'Parameter pencarian anggota tidak valid.',
      )
    }

    const correlationId = correlationIdFor(request)
    try {
      const data = memberListReadModelSchema.parse(await readModel(parsed.data))
      return jsonResponse({ data })
    } catch {
      logFailure({ correlationId })
      return errorResponse(
        request,
        500,
        'INTERNAL_ERROR',
        'Daftar anggota tidak dapat dimuat.',
        undefined,
        undefined,
        correlationId,
      )
    }
  }
}

export const memberListHandler = createMemberListHandler()

export const Route = createFileRoute('/api/v1/members')({
  server: {
    handlers: {
      GET: memberListHandler,
      ANY: methodNotAllowed('GET, HEAD'),
    },
  },
})
