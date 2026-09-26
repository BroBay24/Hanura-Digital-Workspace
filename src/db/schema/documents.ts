import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
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
import { user } from './auth.ts'
import { loanApplications } from './loans.ts'
import { memberReferences } from './members.ts'

export const documentStatus = pgEnum('document_status', [
  'REQUIRED',
  'UPLOADED',
  'VERIFIED',
  'REJECTED',
  'REUPLOAD_REQUIRED',
])

export const documentVerificationAction = pgEnum(
  'document_verification_action',
  ['VERIFIED', 'REJECTED', 'REUPLOAD_REQUESTED'],
)

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    memberReferenceId: uuid('member_reference_id').references(
      () => memberReferences.id,
    ),
    loanApplicationId: uuid('loan_application_id').references(
      () => loanApplications.id,
    ),
    documentType: varchar('document_type', { length: 100 }).notNull(),
    status: documentStatus('status').default('REQUIRED').notNull(),
    currentVersionId: uuid('current_version_id').references(
      (): AnyPgColumn => documentVersions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('documents_member_idx').on(table.memberReferenceId),
    index('documents_loan_idx').on(table.loanApplicationId),
    index('documents_current_version_idx').on(table.currentVersionId),
  ],
)

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    versionNo: integer('version_no').notNull(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    checksum: text('checksum'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => user.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('document_versions_document_version_unique').on(
      table.documentId,
      table.versionNo,
    ),
    index('document_versions_uploaded_by_idx').on(table.uploadedBy),
    check('document_versions_version_positive', sql`${table.versionNo} > 0`),
    check('document_versions_size_nonnegative', sql`${table.sizeBytes} >= 0`),
  ],
)

export const documentVerificationEvents = pgTable(
  'document_verification_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    documentVersionId: uuid('document_version_id').references(
      () => documentVersions.id,
    ),
    action: documentVerificationAction('action').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('document_verification_events_document_created_idx').on(
      table.documentId,
      table.createdAt,
    ),
    index('document_verification_events_version_idx').on(
      table.documentVersionId,
    ),
    index('document_verification_events_actor_idx').on(table.actorUserId),
  ],
)
