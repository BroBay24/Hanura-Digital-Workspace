import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    BETTER_AUTH_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
