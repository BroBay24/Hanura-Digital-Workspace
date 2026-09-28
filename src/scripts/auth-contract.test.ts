import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { session, user } from '#/db/schema'
import { serverEnv } from '#/env.server'
import { auth } from '#/lib/auth'
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

const assertNoSensitiveFields = (body: unknown) => {
  const serialized = JSON.stringify(body)
  assert.equal(serialized.includes(password), false)
  assert.doesNotMatch(serialized.toLowerCase(), /"(?:token|account)"\s*:/)
}

const createdSessionIds = new Set<string>()

after(async () => {
  if (createdSessionIds.size > 0) {
    await db.delete(session).where(inArray(session.id, [...createdSessionIds]))
  }
  await db.$client.end()
})

test('application login and session contract works for all demo identities', async () => {
  for (const identity of demoIdentities) {
    const loginResponse = await login(identity.email.toUpperCase(), password)
    assert.equal(loginResponse.status, 200)
    assert.equal(loginResponse.headers.get('cache-control'), 'no-store')
    assert.ok(loginResponse.headers.getSetCookie().length > 0)

    const loginBody = (await loginResponse.json()) as {
      data: {
        authenticated: boolean
        user: { id: string; email: string; name: string }
      }
    }
    assert.equal(loginBody.data.authenticated, true)
    assert.equal(loginBody.data.user.email, identity.email)
    assertNoSensitiveFields(loginBody)

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
    assert.ok(sessionBody.data.authorization.permissions.length > 0)
    assertNoSensitiveFields(sessionBody)

    const userRow = await db.query.user.findFirst({
      where: eq(user.email, identity.email),
    })
    assert.ok(userRow)
    const userSessions = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userRow.id))
    for (const row of userSessions) createdSessionIds.add(row.id)

    const logoutResponse = await logoutHandler({
      request: applicationRequest('/api/v1/auth/logout', {
        method: 'POST',
        headers: { cookie },
      }),
    })
    assert.equal(logoutResponse.status, 200)
    assert.ok(logoutResponse.headers.getSetCookie().length > 0)
    const logoutBody = await logoutResponse.json()
    assert.deepEqual(logoutBody, { data: { authenticated: false } })
    assertNoSensitiveFields(logoutBody)

    const clearedCookie = cookieJar(logoutResponse)
    const afterLogout = await sessionHandler({
      request: applicationRequest('/api/v1/auth/session', {
        headers: { cookie: clearedCookie },
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
  }
})

test('invalid credentials do not enumerate users', async () => {
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
})

test('login validation errors are stable and safe', async () => {
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

  const loginResponse = await login(demoIdentities[0].email, password)
  const cookie = cookieJar(loginResponse)
  const userRow = await db.query.user.findFirst({
    where: eq(user.email, demoIdentities[0].email),
  })
  assert.ok(userRow)
  const userSessions = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userRow.id))
  await db.delete(session).where(eq(session.userId, userRow.id))
  for (const row of userSessions) createdSessionIds.delete(row.id)

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
  const loginResponse = await login(demoIdentities[0].email, password)
  const cookie = cookieJar(loginResponse)
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
    const userRow = await db.query.user.findFirst({
      where: eq(user.email, demoIdentities[0].email),
    })
    if (userRow) {
      await db.delete(session).where(eq(session.userId, userRow.id))
    }
  }
})

test('native Better Auth get-session remains compatible', async () => {
  const response = await auth.handler(
    new Request(`${origin}/api/auth/get-session`),
  )
  assert.equal(response.status, 200)
})
