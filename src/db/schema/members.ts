import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const memberReferences = pgTable(
  'member_references',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerKey: varchar('provider_key', { length: 100 }).notNull(),
    coreMemberId: varchar('core_member_id', { length: 255 }).notNull(),
    displayNameCache: text('display_name_cache'),
    statusCache: text('status_cache'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('member_references_provider_core_unique').on(
      table.providerKey,
      table.coreMemberId,
    ),
  ],
)

export const memberCoreSnapshots = pgTable(
  'member_core_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    memberReferenceId: uuid('member_reference_id')
      .notNull()
      .references(() => memberReferences.id, { onDelete: 'cascade' }),
    providerKey: varchar('provider_key', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    freshnessStatus: varchar('freshness_status', { length: 50 }).notNull(),
    providerRequestId: text('provider_request_id'),
  },
  (table) => [
    index('member_core_snapshots_member_fetched_idx').on(
      table.memberReferenceId,
      table.fetchedAt,
    ),
  ],
)
