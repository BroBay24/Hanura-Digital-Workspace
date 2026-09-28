import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#/db'
import { account, roles, user, userRoles } from '#/db/schema'
import { serverEnv } from '#/env.server'
import { auth } from '#/lib/auth'
import { takeDemoResetToken } from '#/lib/demo-auth-provisioning'

export const demoIdentities = [
  { email: 'ketua.demo@hanura.local', role: 'CHAIRMAN' },
  { email: 'manager.demo@hanura.local', role: 'MANAGER' },
  { email: 'kredit.demo@hanura.local', role: 'CREDIT_OFFICER' },
  { email: 'teller.demo@hanura.local', role: 'TELLER' },
  { email: 'admin.demo@hanura.local', role: 'ADMIN' },
] as const

export const assertDemoProvisioningEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
) => {
  if (env.NODE_ENV === 'production') {
    throw new Error('Demo credential provisioning is disabled in production')
  }

  if (env.HDW_DEMO_PROVISION !== 'true') {
    throw new Error('HDW_DEMO_PROVISION=true is required')
  }

  const password = env.HDW_DEMO_PASSWORD
  if (!password || password.length < 8 || password.length > 128) {
    throw new Error('HDW_DEMO_PASSWORD must contain 8 to 128 characters')
  }

  const databaseUrl = new URL(env.DATABASE_URL ?? serverEnv.DATABASE_URL)
  if (
    !['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname) ||
    databaseUrl.pathname !== '/hanura_workspace'
  ) {
    throw new Error('Demo credential provisioning requires the local database')
  }

  return password
}

const discoverDemoIdentities = async () => {
  const emails = demoIdentities.map(({ email }) => email)
  const rows = await db
    .select({ id: user.id, email: user.email, role: roles.code })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(user.email, emails))
    .orderBy(user.email)

  assert.equal(rows.length, demoIdentities.length)
  assert.deepEqual(
    rows.map(({ email, role }) => ({ email, role })),
    [...demoIdentities].sort((left, right) =>
      left.email.localeCompare(right.email),
    ),
  )

  return rows
}

export const provisionDemoAuth = async (
  env: NodeJS.ProcessEnv = process.env,
) => {
  const password = assertDemoProvisioningEnvironment(env)
  const before = await discoverDemoIdentities()
  const authOrigin = new URL(serverEnv.BETTER_AUTH_URL).origin

  for (const identity of before) {
    await auth.api.requestPasswordReset({
      body: { email: identity.email },
      headers: new Headers({ origin: authOrigin }),
    })

    const token = takeDemoResetToken(identity.email)
    await auth.api.resetPassword({
      body: { newPassword: password, token },
    })
  }

  const credentialAccounts = await db
    .select({
      id: account.id,
      userId: account.userId,
      accountId: account.accountId,
      password: account.password,
    })
    .from(account)
    .where(
      and(
        eq(account.providerId, 'credential'),
        inArray(
          account.userId,
          before.map(({ id }) => id),
        ),
      ),
    )

  assert.equal(credentialAccounts.length, demoIdentities.length)
  for (const credential of credentialAccounts) {
    assert.equal(credential.accountId, credential.userId)
    assert.ok(credential.password)
  }

  const duplicateAccounts = await db.execute(sql`
    select user_id, count(*)::int as count
    from account
    where provider_id = 'credential'
      and user_id in (${sql.join(
        before.map(({ id }) => sql`${id}`),
        sql`, `,
      )})
    group by user_id
    having count(*) <> 1
  `)
  assert.equal(duplicateAccounts.rows.length, 0)

  const after = await discoverDemoIdentities()
  assert.deepEqual(after, before)

  return {
    users: before.map(({ id, email, role }) => ({ id, email, role })),
    accountIds: credentialAccounts.map(({ id }) => id).sort(),
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  try {
    const result = await provisionDemoAuth()
    console.log(`Demo credentials provisioned for ${result.users.length} users`)
  } finally {
    await db.$client.end()
  }
}
