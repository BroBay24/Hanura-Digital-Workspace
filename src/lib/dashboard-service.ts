import { count, isNotNull } from 'drizzle-orm'
import { db } from '#/db'
import {
  approvals,
  auditEvents,
  creditReviews,
  documents,
  integrationSyncJobs,
  loanApplications,
  memberCoreSnapshots,
  memberReferences,
  rolePermissions,
  user,
  userRoles,
  workspaceSettings,
} from '#/db/schema'
import { PERMISSION_CODES } from './authorization-codes.ts'
import type {
  DashboardReadModel,
  DashboardSection,
  DashboardSectionId,
} from './dashboard-contract.ts'
import { DASHBOARD_SECTION_IDS } from './dashboard-contract.ts'

type CountRow = { key: string | null; value: number }
type SnapshotCountRow = { provider: string; key: string | null; value: number }
type ApprovalCountRow = {
  stage: string
  status: string
  requiredPermission: string
  value: number
}
type ReviewCounts = { total: number; completed: number }
type AccessCounts = {
  users: number
  assignments: number
  permissionMappings: number
}

export class DashboardSourceUnavailableError extends Error {
  constructor() {
    super('Dashboard optional source unavailable')
    this.name = 'DashboardSourceUnavailableError'
  }
}

export type DashboardQueries = {
  memberCounts: () => Promise<Array<SnapshotCountRow>>
  snapshotCounts: () => Promise<Array<SnapshotCountRow>>
  loanCounts: () => Promise<Array<CountRow>>
  documentCounts: () => Promise<Array<CountRow>>
  reviewCounts: () => Promise<ReviewCounts>
  approvalCounts: () => Promise<Array<ApprovalCountRow>>
  accessCounts: () => Promise<AccessCounts>
  auditCounts: () => Promise<Array<CountRow>>
  integrationCounts: () => Promise<Array<SnapshotCountRow>>
  settingsCount: () => Promise<number>
}

const defaultDashboardQueries: DashboardQueries = {
  memberCounts: async () => {
    const rows = await db
      .select({
        provider: memberReferences.providerKey,
        key: memberReferences.statusCache,
        value: count(),
      })
      .from(memberReferences)
      .groupBy(memberReferences.providerKey, memberReferences.statusCache)
    return rows
  },
  snapshotCounts: async () => {
    const rows = await db
      .select({
        provider: memberCoreSnapshots.providerKey,
        key: memberCoreSnapshots.freshnessStatus,
        value: count(),
      })
      .from(memberCoreSnapshots)
      .groupBy(
        memberCoreSnapshots.providerKey,
        memberCoreSnapshots.freshnessStatus,
      )
    return rows
  },
  loanCounts: async () => {
    const rows = await db
      .select({ key: loanApplications.status, value: count() })
      .from(loanApplications)
      .groupBy(loanApplications.status)
    return rows
  },
  documentCounts: async () => {
    const rows = await db
      .select({ key: documents.status, value: count() })
      .from(documents)
      .groupBy(documents.status)
    return rows
  },
  reviewCounts: async () => {
    const [totalRows, completedRows] = await Promise.all([
      db.select({ value: count() }).from(creditReviews),
      db
        .select({ value: count() })
        .from(creditReviews)
        .where(isNotNull(creditReviews.completedAt)),
    ])
    return {
      total: totalRows[0]?.value ?? 0,
      completed: completedRows[0]?.value ?? 0,
    }
  },
  approvalCounts: async () => {
    const rows = await db
      .select({
        stage: approvals.stage,
        status: approvals.status,
        requiredPermission: approvals.requiredPermission,
        value: count(),
      })
      .from(approvals)
      .groupBy(approvals.stage, approvals.status, approvals.requiredPermission)
    return rows
  },
  accessCounts: async () => {
    const [userRows, assignmentRows, mappingRows] = await Promise.all([
      db.select({ value: count() }).from(user),
      db.select({ value: count() }).from(userRoles),
      db.select({ value: count() }).from(rolePermissions),
    ])
    return {
      users: userRows[0]?.value ?? 0,
      assignments: assignmentRows[0]?.value ?? 0,
      permissionMappings: mappingRows[0]?.value ?? 0,
    }
  },
  auditCounts: async () => {
    const rows = await db
      .select({ key: auditEvents.outcome, value: count() })
      .from(auditEvents)
      .groupBy(auditEvents.outcome)
    return rows
  },
  integrationCounts: async () => {
    const rows = await db
      .select({
        provider: integrationSyncJobs.providerKey,
        key: integrationSyncJobs.status,
        value: count(),
      })
      .from(integrationSyncJobs)
      .groupBy(integrationSyncJobs.providerKey, integrationSyncJobs.status)
    return rows
  },
  settingsCount: async () => {
    const rows = await db.select({ value: count() }).from(workspaceSettings)
    return rows[0]?.value ?? 0
  },
}

const metric = (key: string, label: string, value: number) => ({
  key,
  label,
  value,
  unit: 'count' as const,
})

const section = (input: Omit<DashboardSection, 'state'>): DashboardSection => ({
  ...input,
  state: input.metrics.every(({ value }) => value === 0)
    ? 'empty'
    : 'available',
})

const countsByKey = (rows: readonly CountRow[]) => {
  const counts = new Map<string, number>()
  for (const { key, value } of rows) {
    const normalized = key ?? 'UNKNOWN'
    counts.set(normalized, (counts.get(normalized) ?? 0) + value)
  }
  return counts
}

const total = (rows: readonly { value: number }[]) =>
  rows.reduce((sum, row) => sum + row.value, 0)

const hasAnyPermission = (
  permissions: ReadonlySet<string>,
  required: readonly string[],
) => required.some((permission) => permissions.has(permission))

const sectionOrder = new Map(
  DASHBOARD_SECTION_IDS.map((id, index) => [id, index]),
)

export const createDashboardReadModelService = (
  queries: DashboardQueries = defaultDashboardQueries,
) =>
  async function readDashboard(input: {
    permissions: readonly string[]
    generatedAt?: Date
  }): Promise<DashboardReadModel> {
    const permissions = new Set(input.permissions)
    const sections: DashboardSection[] = []
    const degradedSources: DashboardReadModel['context']['degradedSources'] = []

    let loanCountsPromise: Promise<Array<CountRow>> | undefined
    const loanCounts = () => (loanCountsPromise ??= queries.loanCounts())
    let approvalCountsPromise: Promise<Array<ApprovalCountRow>> | undefined
    const approvalCounts = () =>
      (approvalCountsPromise ??= queries.approvalCounts())

    const loaders: Array<{
      id: DashboardSectionId
      allowed: boolean
      load: () => Promise<DashboardSection>
      optionalSource?: true
    }> = [
      {
        id: 'member-overview',
        allowed: permissions.has(PERMISSION_CODES.MEMBER_READ),
        load: async () => {
          const rows = await queries.memberCounts()
          const counts = countsByKey(rows)
          const providers = [...new Set(rows.map(({ provider }) => provider))]
          const provider = providers.length === 1 ? providers[0] : undefined
          return section({
            id: 'member-overview',
            title: 'Member reference cache overview',
            source: {
              kind: provider === 'mock' ? 'mock-cache' : 'provider-cache',
              label: 'Cached core member references',
              ...(provider ? { provider } : {}),
              financialSourceOfTruth: false,
            },
            metrics: [
              metric('total', 'Member references', total(rows)),
              metric(
                'cached-active',
                'Cached active status',
                counts.get('ACTIVE') ?? 0,
              ),
              metric(
                'cached-inactive',
                'Cached inactive status',
                counts.get('INACTIVE') ?? 0,
              ),
              metric(
                'cached-unknown',
                'Cached unknown status',
                counts.get('UNKNOWN') ?? 0,
              ),
            ],
          })
        },
      },
      {
        id: 'member-snapshot-health',
        allowed: permissions.has(PERMISSION_CODES.MEMBER_READ),
        optionalSource: true,
        load: async () => {
          const rows = await queries.snapshotCounts()
          const counts = countsByKey(rows)
          const providers = [...new Set(rows.map(({ provider }) => provider))]
          const provider = providers.length === 1 ? providers[0] : undefined
          return section({
            id: 'member-snapshot-health',
            title: 'Cached member snapshot health',
            source: {
              kind: provider === 'mock' ? 'mock-snapshot' : 'provider-snapshot',
              label: 'Cached core member snapshots',
              ...(provider ? { provider } : {}),
              financialSourceOfTruth: false,
            },
            metrics: [
              metric('total', 'Cached snapshots', total(rows)),
              metric('fresh', 'Fresh snapshots', counts.get('FRESH') ?? 0),
              metric('stale', 'Stale snapshots', counts.get('STALE') ?? 0),
            ],
          })
        },
      },
      {
        id: 'loan-workflow',
        allowed: hasAnyPermission(permissions, [
          PERMISSION_CODES.LOAN_CREATE,
          PERMISSION_CODES.LOAN_UPDATE_DRAFT,
          PERMISSION_CODES.LOAN_SUBMIT,
          PERMISSION_CODES.CREDIT_REVIEW_COMPLETE,
        ]),
        load: async () => {
          const rows = await loanCounts()
          const counts = countsByKey(rows)
          return section({
            id: 'loan-workflow',
            title: 'Loan application workflow',
            source: {
              kind: 'workspace',
              label: 'Workspace loan applications',
              financialSourceOfTruth: false,
            },
            metrics: [
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
            ].map((status) =>
              metric(status.toLowerCase(), status, counts.get(status) ?? 0),
            ),
          })
        },
      },
      {
        id: 'document-workload',
        allowed: hasAnyPermission(permissions, [
          PERMISSION_CODES.DOCUMENT_UPLOAD,
          PERMISSION_CODES.DOCUMENT_VERIFY,
        ]),
        load: async () => {
          const rows = await queries.documentCounts()
          const counts = countsByKey(rows)
          return section({
            id: 'document-workload',
            title: 'Document workflow workload',
            source: {
              kind: 'workspace',
              label: 'Workspace documents',
              financialSourceOfTruth: false,
            },
            metrics: [
              'REQUIRED',
              'UPLOADED',
              'VERIFIED',
              'REJECTED',
              'REUPLOAD_REQUIRED',
            ].map((status) =>
              metric(status.toLowerCase(), status, counts.get(status) ?? 0),
            ),
          })
        },
      },
      {
        id: 'credit-review-workload',
        allowed: permissions.has(PERMISSION_CODES.CREDIT_REVIEW_COMPLETE),
        load: async () => {
          const counts = await queries.reviewCounts()
          return section({
            id: 'credit-review-workload',
            title: 'Credit review workload',
            source: {
              kind: 'workspace',
              label: 'Workspace credit reviews',
              financialSourceOfTruth: false,
            },
            metrics: [
              metric(
                'pending',
                'Pending reviews',
                counts.total - counts.completed,
              ),
              metric('completed', 'Completed reviews', counts.completed),
            ],
          })
        },
      },
      {
        id: 'manager-approval-queue',
        allowed: permissions.has(PERMISSION_CODES.APPROVAL_MANAGER_DECIDE),
        load: async () => {
          const rows = (await approvalCounts()).filter(
            ({ stage, requiredPermission }) =>
              stage === 'MANAGER' &&
              requiredPermission === PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
          )
          const counts = new Map(
            rows.map(({ status, value }) => [status, value]),
          )
          return section({
            id: 'manager-approval-queue',
            title: 'Manager approval queue',
            source: {
              kind: 'workspace',
              label: 'Workspace approvals',
              financialSourceOfTruth: false,
            },
            metrics: [
              metric(
                'pending',
                'Pending decisions',
                counts.get('PENDING') ?? 0,
              ),
              metric(
                'returned',
                'Returned decisions',
                counts.get('RETURNED') ?? 0,
              ),
              metric(
                'rejected',
                'Rejected decisions',
                counts.get('REJECTED') ?? 0,
              ),
            ],
          })
        },
      },
      {
        id: 'chairman-approval-queue',
        allowed: permissions.has(PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE),
        load: async () => {
          const rows = (await approvalCounts()).filter(
            ({ stage, requiredPermission }) =>
              stage === 'CHAIRMAN' &&
              requiredPermission === PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
          )
          const counts = new Map(
            rows.map(({ status, value }) => [status, value]),
          )
          return section({
            id: 'chairman-approval-queue',
            title: 'Chairman approval queue',
            source: {
              kind: 'workspace',
              label: 'Workspace approvals',
              financialSourceOfTruth: false,
            },
            metrics: [
              metric(
                'pending',
                'Pending decisions',
                counts.get('PENDING') ?? 0,
              ),
              metric(
                'returned',
                'Returned decisions',
                counts.get('RETURNED') ?? 0,
              ),
              metric(
                'rejected',
                'Rejected decisions',
                counts.get('REJECTED') ?? 0,
              ),
            ],
          })
        },
      },
      {
        id: 'operational-report',
        allowed: permissions.has(PERMISSION_CODES.REPORT_READ),
        load: async () => {
          const rows = await loanCounts()
          const counts = countsByKey(rows)
          const completed =
            (counts.get('APPROVED') ?? 0) +
            (counts.get('READY_FOR_CORE_INTEGRATION') ?? 0)
          const exception =
            (counts.get('RETURNED_FOR_REVISION') ?? 0) +
            (counts.get('REJECTED') ?? 0)
          return section({
            id: 'operational-report',
            title: 'Workspace workflow summary',
            source: {
              kind: 'workspace-derived',
              label: 'Derived from Workspace loan workflow statuses',
              financialSourceOfTruth: false,
            },
            metrics: [
              metric('applications', 'Applications', total(rows)),
              metric('completed-workflow', 'Completed workflow', completed),
              metric('exceptions', 'Returned or rejected', exception),
            ],
          })
        },
      },
      {
        id: 'access-summary',
        allowed: permissions.has(PERMISSION_CODES.ADMIN_USER_ACCESS),
        load: async () => {
          const counts = await queries.accessCounts()
          return section({
            id: 'access-summary',
            title: 'User and access summary',
            source: {
              kind: 'workspace',
              label: 'Workspace users and RBAC assignments',
              financialSourceOfTruth: false,
            },
            metrics: [
              metric('users', 'Workspace users', counts.users),
              metric(
                'role-assignments',
                'Role assignments',
                counts.assignments,
              ),
              metric(
                'permission-mappings',
                'Role permission mappings',
                counts.permissionMappings,
              ),
            ],
          })
        },
      },
      {
        id: 'audit-summary',
        allowed: permissions.has(PERMISSION_CODES.AUDIT_READ),
        load: async () => {
          const rows = await queries.auditCounts()
          const counts = countsByKey(rows)
          return section({
            id: 'audit-summary',
            title: 'Audit event summary',
            source: {
              kind: 'workspace',
              label: 'Workspace audit events',
              financialSourceOfTruth: false,
            },
            metrics: [
              metric('events', 'Audit events', total(rows)),
              metric(
                'successful',
                'Successful outcomes',
                counts.get('SUCCESS') ?? 0,
              ),
              metric(
                'other',
                'Other outcomes',
                total(rows) - (counts.get('SUCCESS') ?? 0),
              ),
            ],
          })
        },
      },
      {
        id: 'integration-status',
        allowed: permissions.has(PERMISSION_CODES.INTEGRATION_READ),
        load: async () => {
          const rows = await queries.integrationCounts()
          const counts = countsByKey(rows)
          const providers = [...new Set(rows.map(({ provider }) => provider))]
          return section({
            id: 'integration-status',
            title: 'Integration job status',
            source: {
              kind: 'workspace-derived',
              label: 'Workspace integration job records',
              ...(providers.length === 1 ? { provider: providers[0] } : {}),
              financialSourceOfTruth: false,
            },
            metrics: [
              metric('pending', 'Pending jobs', counts.get('PENDING') ?? 0),
              metric('running', 'Running jobs', counts.get('RUNNING') ?? 0),
              metric(
                'succeeded',
                'Succeeded jobs',
                counts.get('SUCCEEDED') ?? 0,
              ),
              metric('failed', 'Failed jobs', counts.get('FAILED') ?? 0),
              metric(
                'retryable-failed',
                'Retryable failed jobs',
                counts.get('RETRYABLE_FAILED') ?? 0,
              ),
            ],
          })
        },
      },
      {
        id: 'settings-summary',
        allowed: permissions.has(PERMISSION_CODES.SETTINGS_MANAGE),
        load: async () =>
          section({
            id: 'settings-summary',
            title: 'Workspace settings summary',
            source: {
              kind: 'workspace',
              label: 'Workspace settings',
              financialSourceOfTruth: false,
            },
            metrics: [
              metric(
                'configured',
                'Configured settings',
                await queries.settingsCount(),
              ),
            ],
          }),
      },
    ]

    const loaded = await Promise.all(
      loaders
        .filter(({ allowed }) => allowed)
        .map(async ({ id, load, optionalSource }) => {
          if (!optionalSource) return load()
          try {
            return await load()
          } catch (error) {
            if (!(error instanceof DashboardSourceUnavailableError)) throw error
            degradedSources.push('member-core-snapshot')
            return {
              id,
              title: 'Cached member snapshot health',
              state: 'unavailable',
              source: {
                kind: 'provider-snapshot',
                label: 'Cached core member snapshots',
                financialSourceOfTruth: false,
              },
              metrics: [],
              unavailableReason: 'source-unavailable',
            } satisfies DashboardSection
          }
        }),
    )

    sections.push(
      ...loaded.sort(
        (left, right) =>
          (sectionOrder.get(left.id) ?? 0) - (sectionOrder.get(right.id) ?? 0),
      ),
    )

    return {
      context: {
        contractVersion: '1',
        generatedAt: (input.generatedAt ?? new Date()).toISOString(),
        degraded: degradedSources.length > 0,
        degradedSources,
      },
      sections,
    }
  }

export const readDashboard = createDashboardReadModelService()
