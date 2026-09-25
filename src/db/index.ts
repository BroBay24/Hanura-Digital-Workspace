import { drizzle } from 'drizzle-orm/node-postgres'
import { serverEnv } from '#/env.server'

import * as schema from './schema.ts'

export const db = drizzle(serverEnv.DATABASE_URL, { schema })
