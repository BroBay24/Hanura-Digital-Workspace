import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    BETTER_AUTH_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    HDW_DEMO_PASSWORD: z.string().min(8).max(128).optional(),
    HDW_DEMO_PROVISION: z.enum(['true']).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
