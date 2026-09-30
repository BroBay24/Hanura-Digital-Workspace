import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { count, eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { session, user } from '#/db/schema'
import { serverEnv } from '#/env.server'
import { auth } from '#/lib/auth'
import { PERMISSION_CODES } from '#/lib/authorization'
import { loginHandler } from '#/routes/api/v1/auth/login'
import { logoutHandler } from '#/routes/api/v1/auth/logout'
import {
  createSessionHandler,
  sessionHandler,
} from '#/routes/api/v1/auth/session'
import { demoIdentities } from './provision-demo-auth.ts'

const origin = new URL(serverEnv.BETTER_AUTH_URL).origin
const password = serverEnv.HDW_DEMO_PASSWORD

if (!password) {
  throw new Error('HDW_DEMO_PASSWORD is required for auth contract tests')
}

const applicationRequest = (
  path: string,
  init?: RequestInit,
  correlationId: string = crypto.randomUUID(),
) =>
  new Request(`${origin}${path}`, {
    ...init,
    headers: {
      origin,
      'x-correlation-id': correlationId,
      ...init?.headers,
    },
  })

const cookieJar = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ')

const login = (email: string, candidatePassword: string) =>
  loginHandler({
    request: applicationRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: candidatePassword }),
    }),
  })

const sensitiveKeys = new Set([
  'accessToken',
  'account',
  'cookie',
  'idToken',
  'refreshToken',
  'secret',
  'sessionToken',
  'token',
])

const assertNoSensitiveFields = (body: unknown) => {
  const serialized = JSON.stringify(body)
  assert.equal(serialized.includes(password), false)
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) inspect(item)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      assert.equal(sensitiveKeys.has(key), false, `sensitive field: ${key}`)
      inspect(child)
    }
  }
  inspect(body)
}

const expectedPermissions = {
  ADMIN: [
    PERMISSION_CODES.ADMIN_USER_ACCESS,
    PERMISSION_CODES.AUDIT_READ,
    PERMISSION_CODES.INTEGRATION_READ,
    PERMISSION_CODES.SETTINGS_MANAGE,
  ],
  CHAIRMAN: [
    PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
    PERMISSION_CODES.MEMBER_READ,
    PERMISSION_CODES.REPORT_READ,
  ],
  CREDIT_OFFICER: [
    PERMISSION_CODES.CREDIT_REVIEW_COMPLETE,
    PERMISSION_CODES.DOCUMENT_UPLOAD,
    PERMISSION_CODES.DOCUMENT_VERIFY,
    PERMISSION_CODES.LOAN_CREATE,
    PERMISSION_CODES.LOAN_SUBMIT,
    PERMISSION_CODES.LOAN_UPDATE_DRAFT,
    PERMISSION_CODES.MEMBER_READ,
  ],
  MANAGER: [
    PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
    PERMISSION_CODES.MEMBER_READ,
    PERMISSION_CODES.REPORT_READ,
  ],
  TELLER: [PERMISSION_CODES.MEMBER_READ],
} as const

const sessionIds = (userId?: string) =>
  userId
    ? db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, userId))
    : db.select({ id: session.id }).from(session)

const createdSessionIds = new Set<string>()

after(async () => {
  if (createdSessionIds.size > 0) {
    await db.delete(session).where(inArray(session.id, [...createdSessionIds]))
  }
  await db.$client.end()
})

test('application login and session contract works for all demo identities', async () => {
  for (const identity of demoIdentities) {
    const userRow = await db.query.user.findFirst({
      where: eq(user.email, identity.email),
    })
    assert.ok(userRow)
    const beforeIds = new Set(
      (await sessionIds(userRow.id)).map(({ id }) => id),
    )

    const loginResponse = await login(identity.email.toUpperCase(), password)
    assert.equal(loginResponse.status, 200)
    assert.equal(loginResponse.headers.get('cache-control'), 'no-store')
    const loginCookies = loginResponse.headers.getSetCookie()
    assert.ok(loginCookies.length > 0)
    const serializedCookies = loginCookies.join(';').toLowerCase()
    assert.match(serializedCookies, /httponly/)
    assert.match(serializedCookies, /samesite=lax/)
    assert.match(serializedCookies, /path=\//)
    if (
      process.env.NODE_ENV === 'production' ||
      origin.startsWith('https://')
    ) {
      assert.match(serializedCookies, /secure/)
    }

    const loginBody = (await loginResponse.json()) as {
      data: {
        authenticated: boolean
        user: { id: string; email: string; name: string }
      }
    }
    assert.equal(loginBody.data.authenticated, true)
    assert.equal(loginBody.data.user.email, identity.email)
    assertNoSensitiveFields(loginBody)

    const created = (await sessionIds(userRow.id)).filter(
      ({ id }) => !beforeIds.has(id),
    )
    assert.equal(created.length, 1)
    const [createdSession] = created
    assert.ok(createdSession)
    createdSessionIds.add(createdSession.id)

    const cookie = cookieJar(loginResponse)
    const sessionResponse = await sessionHandler({
      request: applicationRequest(
        '/api/v1/auth/session?role=ADMIN&permission=*',
        {
          headers: {
            cookie,
            'x-hdw-role': 'ADMIN',
            'x-hdw-permission': '*',
          },
        },
      ),
    })
    assert.equal(sessionResponse.status, 200)
    const sessionBody = (await sessionResponse.json()) as {
      data: {
        authenticated: boolean
        user: { id: string; email: string; name: string }
        session: { expiresAt: string }
        authorization: { roles: Array<string>; permissions: Array<string> }
      }
    }
    assert.equal(sessionBody.data.authenticated, true)
    assert.equal(sessionBody.data.user.id, loginBody.data.user.id)
    assert.equal(sessionBody.data.user.email, identity.email)
    assert.ok(Date.parse(sessionBody.data.session.expiresAt) > Date.now())
    assert.deepEqual(sessionBody.data.authorization.roles, [identity.role])
    assert.deepEqual(
      sessionBody.data.authorization.permissions,
      expectedPermissions[identity.role],
    )
    assertNoSensitiveFields(sessionBody)

    const logoutResponse = await logoutHandler({
      request: applicationRequest('/api/v1/auth/logout', {
        method: 'POST',
        headers: { cookie },
      }),
    })
    assert.equal(logoutResponse.status, 200)
    const logoutCookies = logoutResponse.headers.getSetCookie()
    assert.ok(logoutCookies.length > 0)
    assert.match(logoutCookies.join(';').toLowerCase(), /max-age=0|expires=/)
    const logoutBody = await logoutResponse.json()
    assert.deepEqual(logoutBody, { data: { authenticated: false } })
    assertNoSensitiveFields(logoutBody)

    const afterLogout = await sessionHandler({
      request: applicationRequest('/api/v1/auth/session', {
        headers: { cookie },
      }),
    })
    assert.deepEqual(await afterLogout.json(), {
      data: {
        authenticated: false,
        user: null,
        session: null,
        authorization: null,
      },
    })
    assert.equal(
      (await sessionIds(userRow.id)).some(({ id }) => id === createdSession.id),
      false,
    )
    createdSessionIds.delete(createdSession.id)
  }
})

test('invalid credentials do not enumerate users', async () => {
  const [{ value: sessionsBefore }] = await db
    .select({ value: count() })
    .from(session)
  const correlationId = 'hdw-auth-invalid-credentials'
  const wrongPassword = await login(
    demoIdentities[0].email,
    `${password}-invalid`,
  )
  const unknownIdentity = await login(
    'unknown.demo@hanura.local',
    `${password}-invalid`,
  )

  assert.equal(wrongPassword.status, 401)
  assert.equal(unknownIdentity.status, 401)

  const wrongBody = (await wrongPassword.json()) as {
    error: Record<string, unknown>
  }
  const unknownBody = (await unknownIdentity.json()) as {
    error: Record<string, unknown>
  }

  assert.equal(wrongBody.error.code, 'INVALID_CREDENTIALS')
  assert.equal(unknownBody.error.code, 'INVALID_CREDENTIALS')
  assert.equal(wrongBody.error.message, unknownBody.error.message)
  assertNoSensitiveFields(wrongBody)
  assertNoSensitiveFields(unknownBody)

  const explicitCorrelation = await loginHandler({
    request: applicationRequest(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: demoIdentities[0].email,
          password: `${password}-invalid`,
        }),
      },
      correlationId,
    ),
  })
  const correlationBody = (await explicitCorrelation.json()) as {
    error: { correlationId: string }
  }
  assert.equal(correlationBody.error.correlationId, correlationId)
  const [{ value: sessionsAfter }] = await db
    .select({ value: count() })
    .from(session)
  assert.equal(Number(sessionsAfter), Number(sessionsBefore))
})

test('login validation errors are stable and safe', async () => {
  const [{ value: sessionsBefore }] = await db
    .select({ value: count() })
    .from(session)
  const cases: Array<unknown> = [
    { email: 'not-an-email', password },
    { password },
    { email: demoIdentities[0].email },
    { email: demoIdentities[0].email, password: '' },
  ]

  for (const body of cases) {
    const response = await loginHandler({
      request: applicationRequest('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
    assert.equal(response.status, 400)
    const responseBody = (await response.json()) as {
      error: { code: string }
    }
    assert.equal(responseBody.error.code, 'VALIDATION_ERROR')
    assertNoSensitiveFields(responseBody)
  }

  const malformed = await loginHandler({
    request: applicationRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }),
  })
  assert.equal(malformed.status, 400)
  const [{ value: sessionsAfter }] = await db
    .select({ value: count() })
    .from(session)
  assert.equal(Number(sessionsAfter), Number(sessionsBefore))
})

test('session handles missing, malformed, and stale cookies safely', async () => {
  for (const cookie of [
    undefined,
    'malformed',
    'better-auth.session_token=invalid',
  ]) {
    const response = await sessionHandler({
      request: applicationRequest('/api/v1/auth/session', {
        headers: cookie ? { cookie } : {},
      }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: {
        authenticated: false,
        user: null,
        session: null,
        authorization: null,
      },
    })
  }

  const userRow = await db.query.user.findFirst({
    where: eq(user.email, demoIdentities[0].email),
  })
  assert.ok(userRow)
  const beforeIds = new Set((await sessionIds(userRow.id)).map(({ id }) => id))
  const loginResponse = await login(demoIdentities[0].email, password)
  const cookie = cookieJar(loginResponse)
  const created = (await sessionIds(userRow.id)).filter(
    ({ id }) => !beforeIds.has(id),
  )
  assert.equal(created.length, 1)
  const [createdSession] = created
  assert.ok(createdSession)
  createdSessionIds.add(createdSession.id)
  await db.delete(session).where(eq(session.id, createdSession.id))
  createdSessionIds.delete(createdSession.id)

  const stale = await sessionHandler({
    request: applicationRequest('/api/v1/auth/session', {
      headers: { cookie },
    }),
  })
  assert.deepEqual(await stale.json(), {
    data: {
      authenticated: false,
      user: null,
      session: null,
      authorization: null,
    },
  })
})

test('logout is idempotent without a session', async () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await logoutHandler({
      request: applicationRequest('/api/v1/auth/logout', { method: 'POST' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: { authenticated: false },
    })
  }
})

test('RBAC resolver failures return safe internal errors', async () => {
  const userRow = await db.query.user.findFirst({
    where: eq(user.email, demoIdentities[0].email),
  })
  assert.ok(userRow)
  const beforeIds = new Set((await sessionIds(userRow.id)).map(({ id }) => id))
  const loginResponse = await login(demoIdentities[0].email, password)
  const cookie = cookieJar(loginResponse)
  const created = (await sessionIds(userRow.id)).filter(
    ({ id }) => !beforeIds.has(id),
  )
  assert.equal(created.length, 1)
  const [createdSession] = created
  assert.ok(createdSession)
  createdSessionIds.add(createdSession.id)
  const failingHandler = createSessionHandler(async () => {
    throw new Error('synthetic RBAC database failure')
  })

  const originalError = console.error
  let logged: unknown
  console.error = (...args: Array<unknown>) => {
    logged = args
  }

  try {
    const response = await failingHandler({
      request: applicationRequest('/api/v1/auth/session', {
        headers: { cookie },
      }),
    })
    assert.equal(response.status, 500)
    const body = (await response.json()) as {
      error: { code: string; message: string; correlationId: string }
    }
    assert.equal(body.error.code, 'INTERNAL_ERROR')
    assert.equal(typeof body.error.correlationId, 'string')
    assert.doesNotMatch(JSON.stringify(body), /synthetic RBAC database failure/)
    assert.ok(Array.isArray(logged))
  } finally {
    console.error = originalError
    await db.delete(session).where(eq(session.id, createdSession.id))
    createdSessionIds.delete(createdSession.id)
  }
})

test('cross-origin logout is rejected and cannot invalidate the session', async () => {
  const userRow = await db.query.user.findFirst({
    where: eq(user.email, demoIdentities[1].email),
  })
  assert.ok(userRow)
  const beforeIds = new Set((await sessionIds(userRow.id)).map(({ id }) => id))
  const loginResponse = await login(demoIdentities[1].email, password)
  const cookie = cookieJar(loginResponse)
  const created = (await sessionIds(userRow.id)).filter(
    ({ id }) => !beforeIds.has(id),
  )
  assert.equal(created.length, 1)
  const [createdSession] = created
  assert.ok(createdSession)
  createdSessionIds.add(createdSession.id)

  const originalError = console.error
  console.error = () => undefined
  try {
    const rejected = await logoutHandler({
      request: applicationRequest('/api/v1/auth/logout', {
        method: 'POST',
        headers: { cookie, origin: 'https://attacker.invalid' },
      }),
    })
    assert.equal(rejected.status, 403)
    const rejectedBody = (await rejected.json()) as {
      error: { code: string }
    }
    assert.equal(rejectedBody.error.code, 'FORBIDDEN')
    assertNoSensitiveFields(rejectedBody)

    const stillAuthenticated = await sessionHandler({
      request: applicationRequest('/api/v1/auth/session', {
        headers: { cookie },
      }),
    })
    const body = (await stillAuthenticated.json()) as {
      data: { authenticated: boolean }
    }
    assert.equal(body.data.authenticated, true)
  } finally {
    console.error = originalError
    await db.delete(session).where(eq(session.id, createdSession.id))
    createdSessionIds.delete(createdSession.id)
  }
})

test('native Better Auth get-session remains compatible', async () => {
  const response = await auth.handler(
    new Request(`${origin}/api/auth/get-session`),
  )
  assert.equal(response.status, 200)
})
