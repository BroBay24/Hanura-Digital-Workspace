import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '#/db'
import * as schema from '#/db/schema'
import { serverEnv } from '#/env.server'
import {
  captureDemoResetToken,
  isDemoProvisioningEnabled,
} from './demo-auth-provisioning.ts'

const authOrigin = new URL(serverEnv.BETTER_AUTH_URL).origin

export const auth = betterAuth({
  baseURL: serverEnv.BETTER_AUTH_URL,
  secret: serverEnv.BETTER_AUTH_SECRET,
  trustedOrigins: [authOrigin],
  advanced: {
    useSecureCookies:
      process.env.NODE_ENV === 'production' ||
      authOrigin.startsWith('https://'),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset: true,
    ...(isDemoProvisioningEnabled()
      ? {
          sendResetPassword: async ({ user, token }) => {
            captureDemoResetToken(user.email, token)
          },
        }
      : {}),
  },
  plugins: [tanstackStartCookies()],
})
