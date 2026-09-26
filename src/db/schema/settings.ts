import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { user } from './auth.ts'

export const workspaceSettings = pgTable('workspace_settings', {
  key: varchar('key', { length: 150 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})
