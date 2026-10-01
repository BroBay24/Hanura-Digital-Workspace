import { asc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { permissions, rolePermissions, roles, userRoles } from '#/db/schema'

export { PERMISSION_CODES, ROLE_CODES } from './authorization-codes.ts'
export type { PermissionCode, RoleCode } from './authorization-codes.ts'

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
