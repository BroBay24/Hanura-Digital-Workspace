import { createFileRoute } from '@tanstack/react-router'
import {
  correlationIdFor,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from '#/lib/auth-contract'
import { PERMISSION_CODES } from '#/lib/authorization'
import { requirePermission } from '#/lib/authorization-guards'
import {
  memberDetailParamsSchema,
  memberDetailReadModelSchema,
} from '#/lib/member-contract'
import { memberReadModelService } from '#/lib/member-service'

const memberReadGuard = requirePermission(PERMISSION_CODES.MEMBER_READ)

type MemberReadGuard = typeof memberReadGuard
type MemberDetailReader = typeof memberReadModelService.detail
type MemberDetailRouteContext = {
  request: Request
  params: { id: string }
}

export const createMemberDetailHandler = (dependencies?: {
  authorize?: MemberReadGuard
  readModel?: MemberDetailReader
  logFailure?: (event: { correlationId: string }) => void
}) => {
  const authorize = dependencies?.authorize ?? memberReadGuard
  const readModel = dependencies?.readModel ?? memberReadModelService.detail
  const logFailure =
    dependencies?.logFailure ??
    ((event: { correlationId: string }) =>
      console.error('Member detail read failed', event))

  return async function handleMemberDetail({
    request,
    params,
  }: MemberDetailRouteContext) {
    const authorized = await authorize(request)
    if (!authorized.ok) return authorized.response

    const parsed = memberDetailParamsSchema.safeParse(params)
    if (!parsed.success) {
      return errorResponse(
        request,
        400,
        'VALIDATION_ERROR',
        'Identitas anggota tidak valid.',
      )
    }

    const correlationId = correlationIdFor(request)
    try {
      const result = await readModel(parsed.data)
      if (!result) {
        return errorResponse(
          request,
          404,
          'NOT_FOUND',
          'Anggota tidak ditemukan.',
          undefined,
          undefined,
          correlationId,
        )
      }
      const data = memberDetailReadModelSchema.parse(result)
      return jsonResponse({ data })
    } catch {
      logFailure({ correlationId })
      return errorResponse(
        request,
        500,
        'INTERNAL_ERROR',
        'Detail anggota tidak dapat dimuat.',
        undefined,
        undefined,
        correlationId,
      )
    }
  }
}

export const memberDetailHandler = createMemberDetailHandler()

export const Route = createFileRoute('/api/v1/members/$id')({
  server: {
    handlers: {
      GET: memberDetailHandler,
      ANY: methodNotAllowed('GET, HEAD'),
    },
  },
})
