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
import { user } from './auth.ts'
import { loanApplications } from './loans.ts'

export const approvalStage = pgEnum('approval_stage', ['MANAGER', 'CHAIRMAN'])

export const approvalStatus = pgEnum('approval_status', [
  'PENDING',
  'APPROVED',
  'RETURNED',
  'REJECTED',
])

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    loanApplicationId: uuid('loan_application_id')
      .notNull()
      .references(() => loanApplications.id),
    stage: approvalStage('stage').notNull(),
    cycleNo: integer('cycle_no').default(1).notNull(),
    status: approvalStatus('status').default('PENDING').notNull(),
    requiredPermission: varchar('required_permission', {
      length: 150,
    }).notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    decisionNote: text('decision_note'),
    version: integer('version').default(1).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('approvals_application_stage_cycle_unique').on(
      table.loanApplicationId,
      table.stage,
      table.cycleNo,
    ),
    index('approvals_actor_idx').on(table.actorUserId),
    index('approvals_status_stage_created_idx').on(
      table.status,
      table.stage,
      table.createdAt,
    ),
    check('approvals_cycle_positive', sql`${table.cycleNo} > 0`),
    check('approvals_version_positive', sql`${table.version} > 0`),
  ],
)
