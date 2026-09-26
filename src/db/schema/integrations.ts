import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const integrationSyncJobStatus = pgEnum('integration_sync_job_status', [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'RETRYABLE_FAILED',
])

export const integrationMappings = pgTable(
  'integration_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerKey: varchar('provider_key', { length: 100 }).notNull(),
    internalType: varchar('internal_type', { length: 100 }).notNull(),
    internalId: uuid('internal_id').notNull(),
    externalType: varchar('external_type', { length: 100 }).notNull(),
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('integration_mappings_provider_external_unique').on(
      table.providerKey,
      table.externalType,
      table.externalId,
    ),
    index('integration_mappings_internal_idx').on(
      table.internalType,
      table.internalId,
    ),
  ],
)

export const integrationSyncJobs = pgTable(
  'integration_sync_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerKey: varchar('provider_key', { length: 100 }).notNull(),
    jobType: varchar('job_type', { length: 100 }).notNull(),
    status: integrationSyncJobStatus('status').default('PENDING').notNull(),
    objectType: varchar('object_type', { length: 100 }),
    objectId: uuid('object_id'),
    attemptNo: integer('attempt_no').default(0).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 100 }),
    errorMessageSafe: text('error_message_safe'),
    correlationId: text('correlation_id'),
  },
  (table) => [
    index('integration_sync_jobs_status_started_idx').on(
      table.status,
      table.startedAt,
    ),
    index('integration_sync_jobs_object_idx').on(
      table.objectType,
      table.objectId,
    ),
    index('integration_sync_jobs_correlation_idx').on(table.correlationId),
    check(
      'integration_sync_jobs_attempt_nonnegative',
      sql`${table.attemptNo} >= 0`,
    ),
  ],
)
