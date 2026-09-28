import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import {
  permissions,
  rolePermissions,
  roles,
  user,
  userRoles,
} from '#/db/schema'
import {
  createAuthorizationResolver,
  PERMISSION_CODES,
  resolveAuthorizationContext,
  ROLE_CODES,
} from '#/lib/authorization'

const demoExpectations = [
  {
    userId: 'demo-user-chairman',
    roles: [ROLE_CODES.CHAIRMAN],
    permissions: [
      PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
      PERMISSION_CODES.MEMBER_READ,
      PERMISSION_CODES.REPORT_READ,
    ],
  },
  {
    userId: 'demo-user-manager',
    roles: [ROLE_CODES.MANAGER],
    permissions: [
      PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
      PERMISSION_CODES.MEMBER_READ,
      PERMISSION_CODES.REPORT_READ,
    ],
  },
  {
    userId: 'demo-user-credit-officer',
    roles: [ROLE_CODES.CREDIT_OFFICER],
    permissions: [
      PERMISSION_CODES.CREDIT_REVIEW_COMPLETE,
      PERMISSION_CODES.DOCUMENT_UPLOAD,
      PERMISSION_CODES.DOCUMENT_VERIFY,
      PERMISSION_CODES.LOAN_CREATE,
      PERMISSION_CODES.LOAN_SUBMIT,
      PERMISSION_CODES.LOAN_UPDATE_DRAFT,
      PERMISSION_CODES.MEMBER_READ,
    ],
  },
  {
    userId: 'demo-user-teller',
    roles: [ROLE_CODES.TELLER],
    permissions: [PERMISSION_CODES.MEMBER_READ],
  },
  {
    userId: 'demo-user-admin',
    roles: [ROLE_CODES.ADMIN],
    permissions: [
      PERMISSION_CODES.ADMIN_USER_ACCESS,
      PERMISSION_CODES.AUDIT_READ,
      PERMISSION_CODES.INTEGRATION_READ,
      PERMISSION_CODES.SETTINGS_MANAGE,
    ],
  },
] as const

const testUserIds = [
  'hdw-rbac-no-role-user',
  'hdw-rbac-multi-role-user',
  'hdw-rbac-empty-role-user',
]
const emptyRoleId = 'f9000000-0000-4000-8000-000000000001'

after(async () => {
  await db.delete(userRoles).where(inArray(userRoles.userId, testUserIds))
  await db.delete(user).where(inArray(user.id, testUserIds))
  await db.delete(roles).where(eq(roles.id, emptyRoleId))
  await db.$client.end()
})

test('demo users resolve exact database role and permission matrix', async () => {
  for (const expected of demoExpectations) {
    const context = await resolveAuthorizationContext(expected.userId)
    assert.deepEqual(context, {
      userId: expected.userId,
      roles: [...expected.roles],
      permissions: [...expected.permissions],
    })
  }
})

test('security boundaries match the seeded policy', async () => {
  const teller = await resolveAuthorizationContext('demo-user-teller')
  assert.deepEqual(teller.permissions, [PERMISSION_CODES.MEMBER_READ])

  const manager = await resolveAuthorizationContext('demo-user-manager')
  assert.ok(
    manager.permissions.includes(PERMISSION_CODES.APPROVAL_MANAGER_DECIDE),
  )
  assert.equal(
    manager.permissions.includes(PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE),
    false,
  )

  const chairman = await resolveAuthorizationContext('demo-user-chairman')
  assert.ok(
    chairman.permissions.includes(PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE),
  )
  assert.equal(
    chairman.permissions.includes(PERMISSION_CODES.APPROVAL_MANAGER_DECIDE),
    false,
  )

  const creditOfficer = await resolveAuthorizationContext(
    'demo-user-credit-officer',
  )
  assert.equal(
    creditOfficer.permissions.includes(
      PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
    ),
    false,
  )
  assert.equal(
    creditOfficer.permissions.includes(
      PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
    ),
    false,
  )

  const admin = await resolveAuthorizationContext('demo-user-admin')
  assert.equal(
    admin.permissions.some((permission) => permission.startsWith('approval.')),
    false,
  )
  assert.equal(
    admin.permissions.some((permission) => permission.includes('*')),
    false,
  )
})

test('unknown and no-role users fail closed', async () => {
  const unknown = await resolveAuthorizationContext('unknown-user')
  assert.deepEqual(unknown, {
    userId: 'unknown-user',
    roles: [],
    permissions: [],
  })

  await db.insert(user).values({
    id: testUserIds[0],
    email: 'hdw-rbac-no-role@example.invalid',
    name: 'RBAC No Role Test',
    emailVerified: false,
  })

  const noRole = await resolveAuthorizationContext(testUserIds[0])
  assert.deepEqual(noRole, {
    userId: testUserIds[0],
    roles: [],
    permissions: [],
  })
})

test('role without permissions resolves safely', async () => {
  await db.insert(user).values({
    id: testUserIds[2],
    email: 'hdw-rbac-empty-role@example.invalid',
    name: 'RBAC Empty Role Test',
    emailVerified: false,
  })
  await db.insert(roles).values({
    id: emptyRoleId,
    code: 'HDW_RBAC_EMPTY_TEST',
    name: 'RBAC Empty Test Role',
  })
  await db.insert(userRoles).values({
    userId: testUserIds[2],
    roleId: emptyRoleId,
  })

  const context = await resolveAuthorizationContext(testUserIds[2])
  assert.deepEqual(context, {
    userId: testUserIds[2],
    roles: ['HDW_RBAC_EMPTY_TEST'],
    permissions: [],
  })
})

test('multiple roles union and deduplicate permissions deterministically', async () => {
  await db.insert(user).values({
    id: testUserIds[1],
    email: 'hdw-rbac-multi-role@example.invalid',
    name: 'RBAC Multi Role Test',
    emailVerified: false,
  })

  const assignedRoles = await db
    .select({ id: roles.id, code: roles.code })
    .from(roles)
    .where(inArray(roles.code, [ROLE_CODES.CHAIRMAN, ROLE_CODES.MANAGER]))
  assert.equal(assignedRoles.length, 2)

  await db.insert(userRoles).values(
    assignedRoles.map((role) => ({
      userId: testUserIds[1],
      roleId: role.id,
    })),
  )

  const context = await resolveAuthorizationContext(testUserIds[1])
  assert.deepEqual(context.roles, [ROLE_CODES.CHAIRMAN, ROLE_CODES.MANAGER])
  assert.deepEqual(context.permissions, [
    PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
    PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
    PERMISSION_CODES.MEMBER_READ,
    PERMISSION_CODES.REPORT_READ,
  ])
  assert.equal(
    context.permissions.filter(
      (permission) => permission === PERMISSION_CODES.MEMBER_READ,
    ).length,
    1,
  )
})

test('resolver infrastructure failures propagate instead of returning empty access', async () => {
  const failingResolver = createAuthorizationResolver(async () => {
    throw new Error('synthetic database failure')
  })

  await assert.rejects(
    failingResolver('demo-user-teller'),
    /synthetic database failure/,
  )
})

test('permission constants match the database catalog', async () => {
  const rows = await db.select({ code: permissions.code }).from(permissions)
  assert.deepEqual(
    rows.map(({ code }) => code).sort(),
    Object.values(PERMISSION_CODES).sort(),
  )

  const duplicateMappings = await db
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
  assert.equal(duplicateMappings.length, 18)
})
