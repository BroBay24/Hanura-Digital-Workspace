import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { user } from './auth.ts'
import { memberReferences } from './members.ts'

export const loanApplicationStatus = pgEnum('loan_application_status', [
  'DRAFT',
  'SUBMITTED',
  'DOCUMENT_VERIFICATION',
  'CREDIT_REVIEW',
  'MANAGER_APPROVAL',
  'CHAIRMAN_APPROVAL',
  'APPROVED',
  'READY_FOR_CORE_INTEGRATION',
  'RETURNED_FOR_REVISION',
  'REJECTED',
])

export const loanApplications = pgTable(
  'loan_applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    applicationNo: varchar('application_no', { length: 64 }).notNull().unique(),
    memberReferenceId: uuid('member_reference_id')
      .notNull()
      .references(() => memberReferences.id),
    requestedAmount: numeric('requested_amount', {
      precision: 18,
      scale: 2,
    }).notNull(),
    termMonths: integer('term_months').notNull(),
    purpose: text('purpose').notNull(),
    status: loanApplicationStatus('status').default('DRAFT').notNull(),
    version: integer('version').default(1).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    readyForCoreAt: timestamp('ready_for_core_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('loan_applications_member_updated_idx').on(
      table.memberReferenceId,
      table.updatedAt,
    ),
    index('loan_applications_status_updated_idx').on(
      table.status,
      table.updatedAt,
    ),
    index('loan_applications_created_by_idx').on(table.createdBy),
    check(
      'loan_applications_amount_positive',
      sql`${table.requestedAmount} > 0`,
    ),
    check('loan_applications_term_positive', sql`${table.termMonths} > 0`),
    check('loan_applications_version_positive', sql`${table.version} > 0`),
  ],
)

export const loanStatusHistory = pgTable(
  'loan_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    loanApplicationId: uuid('loan_application_id')
      .notNull()
      .references(() => loanApplications.id),
    fromStatus: loanApplicationStatus('from_status'),
    toStatus: loanApplicationStatus('to_status').notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('loan_status_history_application_created_idx').on(
      table.loanApplicationId,
      table.createdAt,
    ),
    index('loan_status_history_actor_idx').on(table.actorUserId),
  ],
)

export const creditReviews = pgTable(
  'credit_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    loanApplicationId: uuid('loan_application_id')
      .notNull()
      .references(() => loanApplications.id),
    reviewerUserId: text('reviewer_user_id')
      .notNull()
      .references(() => user.id),
    recommendation: varchar('recommendation', { length: 100 }).notNull(),
    note: text('note'),
    version: integer('version').default(1).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('credit_reviews_application_unique').on(table.loanApplicationId),
    index('credit_reviews_reviewer_idx').on(table.reviewerUserId),
    check('credit_reviews_version_positive', sql`${table.version} > 0`),
  ],
)
