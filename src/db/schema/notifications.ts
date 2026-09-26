import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { user } from './auth.ts'

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 100 }).notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    objectType: varchar('object_type', { length: 100 }),
    objectId: uuid('object_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('notifications_recipient_read_created_idx').on(
      table.recipientUserId,
      table.readAt,
      table.createdAt,
    ),
  ],
)
