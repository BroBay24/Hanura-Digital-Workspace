import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#/db'
import { account, roles, session, user, userRoles } from '#/db/schema'
import { serverEnv } from '#/env.server'
import { auth } from '#/lib/auth'
import {
  assertDemoProvisioningEnvironment,
  demoIdentities,
  provisionDemoAuth,
} from './provision-demo-auth.ts'

const authOrigin = new URL(serverEnv.BETTER_AUTH_URL).origin
const password = serverEnv.HDW_DEMO_PASSWORD

if (!password) {
  throw new Error('HDW_DEMO_PASSWORD is required for auth integration tests')
}

const demoEmails = demoIdentities.map(({ email }) => email)

const identitySnapshot = async () =>
  db
    .select({ id: user.id, email: user.email, role: roles.code })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(user.email, demoEmails))
    .orderBy(user.email)

const credentialAccountIds = async () =>
  db
    .select({ id: account.id })
    .from(account)
    .where(
      inArray(
        account.userId,
        db
          .select({ id: user.id })
          .from(user)
          .where(inArray(user.email, demoEmails)),
      ),
    )
    .orderBy(account.id)

const signIn = (email: string, candidatePassword: string) =>
  auth.handler(
    new Request(`${authOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: authOrigin,
      },
      body: JSON.stringify({
        email,
        password: candidatePassword,
        rememberMe: false,
      }),
    }),
  )

const sessionCookie = (response: Response) => {
  const setCookie = response.headers.get('set-cookie')
  assert.ok(setCookie)
  assert.match(setCookie.toLowerCase(), /httponly/)
  assert.match(setCookie.toLowerCase(), /samesite=lax/)
  if (authOrigin.startsWith('https://')) {
    assert.match(setCookie.toLowerCase(), /secure/)
  }
  return setCookie.split(';', 1)[0]
}

after(async () => {
  await db.$client.end()
})

test('demo credential provisioning and native Better Auth runtime', async () => {
  const identitiesBefore = await identitySnapshot()
  assert.equal(identitiesBefore.length, 5)

  const first = await provisionDemoAuth()
  const accountIdsAfterFirst = await credentialAccountIds()
  assert.equal(first.users.length, 5)
  assert.equal(accountIdsAfterFirst.length, 5)

  const second = await provisionDemoAuth()
  const accountIdsAfterSecond = await credentialAccountIds()
  assert.deepEqual(second.accountIds, first.accountIds)
  assert.deepEqual(accountIdsAfterSecond, accountIdsAfterFirst)
  assert.deepEqual(await identitySnapshot(), identitiesBefore)

  const migrationResult = await db.execute(sql`
    select count(*)::int as count from drizzle.__drizzle_migrations
  `)
  assert.equal(migrationResult.rows[0]?.count, 2)

  const [sessionsBefore] = await db.select({ value: count() }).from(session)

  for (const identity of demoIdentities) {
    const response = await signIn(identity.email, password)
    assert.equal(response.status, 200)
    const cookie = sessionCookie(response)

    const sessionResponse = await auth.handler(
      new Request(`${authOrigin}/api/auth/get-session`, {
        headers: { cookie },
      }),
    )
    assert.equal(sessionResponse.status, 200)
    const body = (await sessionResponse.json()) as {
      user?: { email?: string }
    }
    assert.equal(body.user?.email, identity.email)

    const signOutResponse = await auth.handler(
      new Request(`${authOrigin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { cookie, origin: authOrigin },
      }),
    )
    assert.equal(signOutResponse.status, 200)
  }

  const invalidResponse = await signIn(
    demoIdentities[0].email,
    `${password}-invalid`,
  )
  assert.notEqual(invalidResponse.status, 200)

  const [sessionsAfter] = await db.select({ value: count() }).from(session)
  assert.equal(Number(sessionsAfter.value), Number(sessionsBefore.value))

  assert.equal(auth.options.session.expiresIn, 60 * 60 * 24 * 7)
  assert.equal(auth.options.session.updateAge, 60 * 60 * 24)
  assert.equal(
    auth.options.advanced.useSecureCookies,
    process.env.NODE_ENV === 'production' || authOrigin.startsWith('https://'),
  )
})

test('demo provisioning guards reject unsafe environments', () => {
  assert.throws(() =>
    assertDemoProvisioningEnvironment({
      ...process.env,
      NODE_ENV: 'production',
    }),
  )
  assert.throws(() =>
    assertDemoProvisioningEnvironment({
      ...process.env,
      HDW_DEMO_PROVISION: undefined,
    }),
  )
  assert.throws(() =>
    assertDemoProvisioningEnvironment({
      ...process.env,
      DATABASE_URL: 'postgresql://example.com/hanura_workspace',
    }),
  )
})
