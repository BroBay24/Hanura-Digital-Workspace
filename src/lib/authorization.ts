import { asc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { permissions, rolePermissions, roles, userRoles } from '#/db/schema'

export const ROLE_CODES = {
  ADMIN: 'ADMIN',
  CHAIRMAN: 'CHAIRMAN',
  CREDIT_OFFICER: 'CREDIT_OFFICER',
  MANAGER: 'MANAGER',
  TELLER: 'TELLER',
} as const

export const PERMISSION_CODES = {
  ADMIN_USER_ACCESS: 'admin.user_access',
  APPROVAL_CHAIRMAN_DECIDE: 'approval.chairman.decide',
  APPROVAL_MANAGER_DECIDE: 'approval.manager.decide',
  AUDIT_READ: 'audit.read',
  CREDIT_REVIEW_COMPLETE: 'credit_review.complete',
  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_VERIFY: 'document.verify',
  INTEGRATION_READ: 'integration.read',
  LOAN_CREATE: 'loan.create',
  LOAN_SUBMIT: 'loan.submit',
  LOAN_UPDATE_DRAFT: 'loan.update_draft',
  MEMBER_READ: 'member.read',
  REPORT_READ: 'report.read',
  SETTINGS_MANAGE: 'settings.manage',
} as const

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES]
export type PermissionCode =
  (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES]

export type AuthorizationContext = {
  userId: string
  roles: Array<string>
  permissions: Array<string>
}

type AuthorizationRow = {
  role: string
  permission: string | null
}

export type AuthorizationQuery = (
  userId: string,
) => Promise<Array<AuthorizationRow>>

const queryAuthorizationRows: AuthorizationQuery = (userId) =>
  db
    .select({
      role: roles.code,
      permission: permissions.code,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId))
    .orderBy(asc(roles.code), asc(permissions.code))

export const createAuthorizationResolver = (query: AuthorizationQuery) =>
  async function resolve(userId: string): Promise<AuthorizationContext> {
    const rows = await query(userId)
    const resolvedRoles = new Set<string>()
    const resolvedPermissions = new Set<string>()

    for (const row of rows) {
      resolvedRoles.add(row.role)
      if (row.permission) {
        resolvedPermissions.add(row.permission)
      }
    }

    return {
      userId,
      roles: [...resolvedRoles].sort(),
      permissions: [...resolvedPermissions].sort(),
    }
  }

export const resolveAuthorizationContext = createAuthorizationResolver(
  queryAuthorizationRows,
)
