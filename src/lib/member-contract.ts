import { z } from 'zod'
import { dashboardSourceSchema } from './dashboard-contract.ts'

export const MEMBER_DEGRADED_SOURCES = ['member-core-snapshot'] as const

export const memberSnapshotSummarySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('present'),
      freshness: z.enum(['fresh', 'stale', 'unknown']),
      fetchedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime().nullable(),
      source: dashboardSourceSchema,
    })
    .strict(),
  z.object({ state: z.literal('missing') }).strict(),
  z
    .object({
      state: z.literal('unavailable'),
      unavailableReason: z.literal('source-unavailable'),
    })
    .strict(),
])

export const memberSummarySchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().min(1),
    memberReference: z.string().min(1),
    status: z.string().nullable(),
    source: dashboardSourceSchema,
    snapshot: memberSnapshotSummarySchema,
    updatedAt: z.iso.datetime(),
  })
  .strict()

export const memberListReadModelSchema = z
  .object({
    context: z
      .object({
        contractVersion: z.literal('1'),
        generatedAt: z.iso.datetime(),
        degraded: z.boolean(),
        degradedSources: z.array(z.enum(MEMBER_DEGRADED_SOURCES)),
      })
      .strict(),
    query: z.string(),
    members: z.array(memberSummarySchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((model, context) => {
    if (model.context.degraded !== model.context.degradedSources.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Degraded flag must match degraded sources.',
      })
    }
    if (model.members.length > model.pagination.pageSize) {
      context.addIssue({
        code: 'custom',
        message: 'Member page exceeds the declared page size.',
      })
    }
  })

export const memberDetailReadModelSchema = z
  .object({
    context: z
      .object({
        contractVersion: z.literal('1'),
        generatedAt: z.iso.datetime(),
        degraded: z.boolean(),
        degradedSources: z.array(z.enum(MEMBER_DEGRADED_SOURCES)),
      })
      .strict(),
    member: memberSummarySchema,
  })
  .strict()
  .superRefine((model, context) => {
    if (model.context.degraded !== model.context.degradedSources.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Degraded flag must match degraded sources.',
      })
    }
  })

export const memberDetailParamsSchema = z.object({ id: z.uuid() }).strict()

export const memberListQuerySchema = z
  .object({
    q: z.string().max(100).optional().default(''),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()

export type MemberSummary = z.infer<typeof memberSummarySchema>
export type MemberListReadModel = z.infer<typeof memberListReadModelSchema>
export type MemberDetailReadModel = z.infer<typeof memberDetailReadModelSchema>
export type MemberListQuery = z.infer<typeof memberListQuerySchema>
