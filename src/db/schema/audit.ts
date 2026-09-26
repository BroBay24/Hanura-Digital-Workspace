import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { user } from './auth.ts'

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorType: varchar('actor_type', { length: 50 }).notNull(),
    action: varchar('action', { length: 150 }).notNull(),
    objectType: varchar('object_type', { length: 100 }).notNull(),
    objectId: text('object_id').notNull(),
    outcome: varchar('outcome', { length: 50 }).notNull(),
    metadata: jsonb('metadata'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('audit_events_object_created_idx').on(
      table.objectType,
      table.objectId,
      table.createdAt,
    ),
    index('audit_events_actor_created_idx').on(
      table.actorUserId,
      table.createdAt,
    ),
    index('audit_events_correlation_idx').on(table.correlationId),
  ],
)
