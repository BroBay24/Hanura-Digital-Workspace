import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { roles, session, user, userRoles } from '#/db/schema'
import { serverEnv } from '#/env.server'
import { auth } from '#/lib/auth'
import { hasPermission } from '#/lib/session-client'
import { navigationItemsFor } from '#/lib/navigation'
import {
  createAuthorizationGuards,
  requireAuthenticated,
  requirePermission,
} from '#/lib/authorization-guards'
import {
  PERMISSION_CODES,
  resolveAuthorizationContext,
  ROLE_CODES,
} from '#/lib/authorization'
import { demoIdentities } from './provision-demo-auth.ts'

const origin = new URL(serverEnv.BETTER_AUTH_URL).origin
const password = serverEnv.HDW_DEMO_PASSWORD

if (!password) {
  throw new Error('HDW_DEMO_PASSWORD is required for authorization guard tests')
}

const testUserIds = ['hdw-guard-no-role-user', 'hdw-guard-multi-role-user']
const createdSessionIds = new Set<string>()

const request = (options?: {
  cookie?: string
  query?: string
  headers?: Record<string, string>
  correlationId?: string
}) =>
  new Request(`${origin}/guard-test${options?.query ?? ''}`, {
    headers: {
      ...(options?.cookie ? { cookie: options.cookie } : {}),
      ...(options?.correlationId
        ? { 'x-correlation-id': options.correlationId }
        : {}),
      ...options?.headers,
    },
  })

const cookieJar = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ')

const sessionIds = (userId: string) =>
  db.select({ id: session.id }).from(session).where(eq(session.userId, userId))

const nativeSignIn = (email: string) =>
  auth.handler(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, password }),
    }),
  )

const stubSession = (userId: string) => ({
  session: {
    id: 'guard-session',
    userId,
    token: 'not-exposed',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  user: {
    id: userId,
    email: `${userId}@example.invalid`,
    name: 'Guard Test User',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
})

after(async () => {
  if (createdSessionIds.size > 0) {
    await db.delete(session).where(inArray(session.id, [...createdSessionIds]))
  }
  await db.delete(userRoles).where(inArray(userRoles.userId, testUserIds))
  await db.delete(user).where(inArray(user.id, testUserIds))
  await db.$client.end()
})

test('requireAuthenticated separates unauthenticated and infrastructure failures', async () => {
  const logs: Array<unknown> = []
  const guards = createAuthorizationGuards({
    getSession: async () => null,
    resolveAuthorization: resolveAuthorizationContext,
    logFailure: (event) => logs.push(event),
  })

  const unauthenticated = await guards.requireAuthenticated(
    request({ correlationId: 'guard-401' }),
  )
  assert(!unauthenticated.ok)
  assert.equal(unauthenticated.response.status, 401)
  assert.deepEqual(await unauthenticated.response.json(), {
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Autentikasi diperlukan.',
      correlationId: 'guard-401',
    },
  })
  assert.equal(logs.length, 0)

  const failingSession = createAuthorizationGuards({
    getSession: async () => {
      throw new Error('synthetic session database failure')
    },
    resolveAuthorization: resolveAuthorizationContext,
    logFailure: (event) => logs.push(event),
  })
  const sessionFailure = await failingSession.requireAuthenticated(
    request({ correlationId: 'guard-session-500' }),
  )
  assert(!sessionFailure.ok)
  assert.equal(sessionFailure.response.status, 500)
  const sessionFailureBody = (await sessionFailure.response.json()) as {
    error: { code: string; correlationId: string }
  }
  assert.equal(sessionFailureBody.error.code, 'INTERNAL_ERROR')
  assert.equal(sessionFailureBody.error.correlationId, 'guard-session-500')

  const failingRbac = createAuthorizationGuards({
    getSession: async () => stubSession('guard-user'),
    resolveAuthorization: async () => {
      throw new Error('synthetic RBAC database failure')
    },
    logFailure: (event) => logs.push(event),
  })
  const rbacFailure = await failingRbac.requireAuthenticated(
    request({ correlationId: 'guard-rbac-500' }),
  )
  assert(!rbacFailure.ok)
  assert.equal(rbacFailure.response.status, 500)
  const rbacFailureBody = (await rbacFailure.response.json()) as {
    error: { code: string; correlationId: string }
  }
  assert.equal(rbacFailureBody.error.code, 'INTERNAL_ERROR')
  assert.equal(rbacFailureBody.error.correlationId, 'guard-rbac-500')
  assert.deepEqual(logs, [
    { correlationId: 'guard-session-500', stage: 'session_lookup' },
    { correlationId: 'guard-rbac-500', stage: 'rbac_resolution' },
  ])
})

test('malformed trusted session identity is an internal error', async () => {
  const guards = createAuthorizationGuards({
    getSession: async () => ({
      ...stubSession('guard-user'),
      session: { ...stubSession('guard-user').session, userId: 'other-user' },
    }),
    resolveAuthorization: resolveAuthorizationContext,
    logFailure: () => undefined,
  })
  const result = await guards.requireAuthenticated(request())
  assert(!result.ok)
  assert.equal(result.response.status, 500)
})

test('permission guard enforces exact seeded role matrix', async () => {
  const matrix = [
    {
      userId: 'demo-user-teller',
      allow: [PERMISSION_CODES.MEMBER_READ],
      deny: [
        PERMISSION_CODES.LOAN_CREATE,
        PERMISSION_CODES.LOAN_SUBMIT,
        PERMISSION_CODES.DOCUMENT_VERIFY,
        PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
        PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
        PERMISSION_CODES.ADMIN_USER_ACCESS,
        PERMISSION_CODES.SETTINGS_MANAGE,
      ],
    },
    {
      userId: 'demo-user-manager',
      allow: [
        PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
        PERMISSION_CODES.MEMBER_READ,
        PERMISSION_CODES.REPORT_READ,
      ],
      deny: [
        PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
        PERMISSION_CODES.ADMIN_USER_ACCESS,
      ],
    },
    {
      userId: 'demo-user-chairman',
      allow: [
        PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
        PERMISSION_CODES.MEMBER_READ,
        PERMISSION_CODES.REPORT_READ,
      ],
      deny: [
        PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
        PERMISSION_CODES.ADMIN_USER_ACCESS,
      ],
    },
    {
      userId: 'demo-user-credit-officer',
      allow: [
        PERMISSION_CODES.LOAN_CREATE,
        PERMISSION_CODES.LOAN_SUBMIT,
        PERMISSION_CODES.LOAN_UPDATE_DRAFT,
        PERMISSION_CODES.DOCUMENT_UPLOAD,
        PERMISSION_CODES.DOCUMENT_VERIFY,
        PERMISSION_CODES.CREDIT_REVIEW_COMPLETE,
        PERMISSION_CODES.MEMBER_READ,
      ],
      deny: [
        PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
        PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
        PERMISSION_CODES.ADMIN_USER_ACCESS,
      ],
    },
    {
      userId: 'demo-user-admin',
      allow: [
        PERMISSION_CODES.ADMIN_USER_ACCESS,
        PERMISSION_CODES.AUDIT_READ,
        PERMISSION_CODES.INTEGRATION_READ,
        PERMISSION_CODES.SETTINGS_MANAGE,
      ],
      deny: [
        PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
        PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
      ],
    },
  ]

  for (const expectation of matrix) {
    const guards = createAuthorizationGuards({
      getSession: async () => stubSession(expectation.userId),
      resolveAuthorization: resolveAuthorizationContext,
      logFailure: () => undefined,
    })

    for (const permission of expectation.allow) {
      const result = await guards.requirePermission(permission)(request())
      assert(result.ok, `${expectation.userId}:${permission}`)
      assert.equal(result.principal.user.id, expectation.userId)
      assert.equal('token' in result.principal.user, false)
    }

    for (const permission of expectation.deny) {
      const result = await guards.requirePermission(permission)(
        request({
          query: '?role=ADMIN&permission=*',
          headers: {
            'x-role': 'ADMIN',
            'x-permission': '*',
          },
          correlationId: 'guard-403',
        }),
      )
      assert(!result.ok, `${expectation.userId}:${permission}`)
      assert.equal(result.response.status, 403)
      assert.deepEqual(await result.response.json(), {
        error: {
          code: 'FORBIDDEN',
          message: 'Akses ditolak.',
          correlationId: 'guard-403',
        },
      })
    }
  }
})

test('authenticated no-role user passes authentication and fails permission checks', async () => {
  await db.insert(user).values({
    id: testUserIds[0],
    email: 'hdw-guard-no-role@example.invalid',
    name: 'Guard No Role Test',
    emailVerified: false,
  })

  const guards = createAuthorizationGuards({
    getSession: async () => stubSession(testUserIds[0]),
    resolveAuthorization: resolveAuthorizationContext,
    logFailure: () => undefined,
  })

  const authenticated = await guards.requireAuthenticated(request())
  assert(authenticated.ok)
  assert.deepEqual(authenticated.principal.authorization.roles, [])
  assert.deepEqual(authenticated.principal.authorization.permissions, [])

  const denied = await guards.requirePermission(PERMISSION_CODES.MEMBER_READ)(
    request(),
  )
  assert(!denied.ok)
  assert.equal(denied.response.status, 403)
})

test('multi-role permission union is enforced', async () => {
  await db.insert(user).values({
    id: testUserIds[1],
    email: 'hdw-guard-multi-role@example.invalid',
    name: 'Guard Multi Role Test',
    emailVerified: false,
  })
  const assignedRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.code, [ROLE_CODES.CHAIRMAN, ROLE_CODES.MANAGER]))
  await db.insert(userRoles).values(
    assignedRoles.map((role) => ({
      userId: testUserIds[1],
      roleId: role.id,
    })),
  )

  const guards = createAuthorizationGuards({
    getSession: async () => stubSession(testUserIds[1]),
    resolveAuthorization: resolveAuthorizationContext,
    logFailure: () => undefined,
  })

  const manager = await guards.requirePermission(
    PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
  )(request())
  const chairman = await guards.requirePermission(
    PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
  )(request())
  assert.equal(manager.ok, true)
  assert.equal(chairman.ok, true)
})

test('permission changes are visible on the next check with no cache', async () => {
  const tellerRole = await db.query.roles.findFirst({
    where: eq(roles.code, ROLE_CODES.TELLER),
  })
  assert.ok(tellerRole)

  const guards = createAuthorizationGuards({
    getSession: async () => stubSession(testUserIds[0]),
    resolveAuthorization: resolveAuthorizationContext,
    logFailure: () => undefined,
  })

  const before = await guards.requirePermission(PERMISSION_CODES.MEMBER_READ)(
    request(),
  )
  assert.equal(before.ok, false)
  assert.deepEqual(
    navigationItemsFor(
      (await resolveAuthorizationContext(testUserIds[0])).permissions,
    ).map(({ id }) => id),
    ['dashboard'],
  )

  await db.insert(userRoles).values({
    userId: testUserIds[0],
    roleId: tellerRole.id,
  })
  const afterGrant = await guards.requirePermission(
    PERMISSION_CODES.MEMBER_READ,
  )(request())
  assert.equal(afterGrant.ok, true)
  assert.deepEqual(
    navigationItemsFor(
      (await resolveAuthorizationContext(testUserIds[0])).permissions,
    ).map(({ id }) => id),
    ['dashboard', 'members'],
  )

  await db.delete(userRoles).where(eq(userRoles.userId, testUserIds[0]))
  const afterRevoke = await guards.requirePermission(
    PERMISSION_CODES.MEMBER_READ,
  )(request())
  assert.equal(afterRevoke.ok, false)
  assert.deepEqual(
    navigationItemsFor(
      (await resolveAuthorizationContext(testUserIds[0])).permissions,
    ).map(({ id }) => id),
    ['dashboard'],
  )
})

test('production guard uses authoritative Better Auth session and DB permissions', async () => {
  const beforeIds = new Set(
    (await sessionIds('demo-user-manager')).map(({ id }) => id),
  )
  const response = await nativeSignIn(demoIdentities[1].email)
  assert.equal(response.status, 200)
  const cookie = cookieJar(response)

  const allowed = await requirePermission(
    PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
  )(request({ cookie }))
  assert(allowed.ok)
  assert.equal(allowed.principal.user.id, 'demo-user-manager')
  assert.deepEqual(allowed.principal.authorization.roles, [ROLE_CODES.MANAGER])

  const denied = await requirePermission(
    PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
  )(request({ cookie }))
  assert(!denied.ok)
  assert.equal(denied.response.status, 403)

  const authenticated = await requireAuthenticated(request({ cookie }))
  assert(authenticated.ok)

  const created = (await sessionIds('demo-user-manager')).filter(
    ({ id }) => !beforeIds.has(id),
  )
  assert.equal(created.length, 1)
  createdSessionIds.add(created[0].id)
})

test('body and client-state privilege injection cannot override the guard', async () => {
  const forgedSession = {
    data: {
      authenticated: true as const,
      user: {
        id: 'demo-user-teller',
        email: 'teller.demo@hanura.local',
        name: 'Demo Teller',
      },
      session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
      authorization: {
        roles: [ROLE_CODES.ADMIN],
        permissions: [PERMISSION_CODES.ADMIN_USER_ACCESS],
      },
    },
  }
  assert.equal(
    hasPermission(forgedSession, PERMISSION_CODES.ADMIN_USER_ACCESS),
    true,
  )

  const guards = createAuthorizationGuards({
    getSession: async () => stubSession('demo-user-teller'),
    resolveAuthorization: resolveAuthorizationContext,
    logFailure: () => undefined,
  })
  const result = await guards.requirePermission(
    PERMISSION_CODES.ADMIN_USER_ACCESS,
  )(
    new Request(`${origin}/guard-test?role=ADMIN`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-role': 'ADMIN',
        'x-permission': '*',
      },
      body: JSON.stringify({
        role: 'ADMIN',
        permission: PERMISSION_CODES.ADMIN_USER_ACCESS,
      }),
    }),
  )
  assert(!result.ok)
  assert.equal(result.response.status, 403)
})

test('invalid session is unauthenticated with production guard', async () => {
  const result = await requireAuthenticated(
    request({ cookie: 'better-auth.session_token=invalid' }),
  )
  assert(!result.ok)
  assert.equal(result.response.status, 401)
})
