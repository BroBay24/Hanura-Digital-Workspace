import { z } from 'zod'

export const DASHBOARD_SECTION_IDS = [
  'member-overview',
  'member-snapshot-health',
  'loan-workflow',
  'document-workload',
  'credit-review-workload',
  'manager-approval-queue',
  'chairman-approval-queue',
  'operational-report',
  'access-summary',
  'audit-summary',
  'integration-status',
  'settings-summary',
] as const

export const DASHBOARD_DEGRADED_SOURCES = ['member-core-snapshot'] as const

export const dashboardSourceSchema = z
  .object({
    kind: z.enum([
      'workspace',
      'workspace-derived',
      'mock-cache',
      'provider-cache',
      'mock-snapshot',
      'provider-snapshot',
    ]),
    label: z.string().min(1),
    provider: z.string().min(1).optional(),
    financialSourceOfTruth: z.literal(false),
  })
  .strict()

export const dashboardMetricSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    value: z.number().int().nonnegative(),
    unit: z.literal('count'),
  })
  .strict()

export const dashboardSectionSchema = z
  .object({
    id: z.enum(DASHBOARD_SECTION_IDS),
    title: z.string().min(1),
    state: z.enum(['available', 'empty', 'unavailable']),
    source: dashboardSourceSchema,
    metrics: z.array(dashboardMetricSchema),
    unavailableReason: z.literal('source-unavailable').optional(),
  })
  .strict()
  .superRefine((section, context) => {
    if (
      section.state === 'available' &&
      section.metrics.every(({ value }) => value === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Available sections must contain a non-zero metric.',
      })
    }
    if (
      section.state === 'empty' &&
      section.metrics.some(({ value }) => value !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Empty sections cannot contain non-zero metrics.',
      })
    }
    if (section.state === 'unavailable') {
      if (section.metrics.length > 0 || !section.unavailableReason) {
        context.addIssue({
          code: 'custom',
          message: 'Unavailable sections must have no metrics and a reason.',
        })
      }
      return
    }
    if (section.unavailableReason) {
      context.addIssue({
        code: 'custom',
        message:
          'Available and empty sections cannot have an unavailable reason.',
      })
    }
  })

export const dashboardReadModelSchema = z
  .object({
    context: z
      .object({
        contractVersion: z.literal('1'),
        generatedAt: z.iso.datetime(),
        degraded: z.boolean(),
        degradedSources: z.array(z.enum(DASHBOARD_DEGRADED_SOURCES)),
      })
      .strict(),
    sections: z.array(dashboardSectionSchema),
  })
  .strict()
  .superRefine((model, context) => {
    if (model.context.degraded !== model.context.degradedSources.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Degraded flag must match degraded sources.',
      })
    }
    const ids = model.sections.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'Dashboard section IDs must be unique.',
      })
    }
  })

export type DashboardReadModel = z.infer<typeof dashboardReadModelSchema>
export type DashboardSection = z.infer<typeof dashboardSectionSchema>
export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number]
