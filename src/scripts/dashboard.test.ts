import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { db } from '#/db'
import { errorResponse } from '#/lib/auth-contract'
import {
  PERMISSION_CODES,
  resolveAuthorizationContext,
} from '#/lib/authorization'
import type { DashboardReadModel } from '#/lib/dashboard-contract'
import { dashboardReadModelSchema } from '#/lib/dashboard-contract'
import type { DashboardQueries } from '#/lib/dashboard-service'
import {
  createDashboardReadModelService,
  DashboardSourceUnavailableError,
  readDashboard,
} from '#/lib/dashboard-service'
import { createDashboardHandler } from '#/routes/api/v1/dashboard'

const generatedAt = new Date('2026-02-01T00:00:00.000Z')

const sectionIds = (model: DashboardReadModel) =>
  model.sections.map(({ id }) => id)

const metricValue = (
  model: DashboardReadModel,
  sectionId: DashboardReadModel['sections'][number]['id'],
  key: string,
) =>
  model.sections
    .find(({ id }) => id === sectionId)
    ?.metrics.find((metric) => metric.key === key)?.value

const fixtureQueries = (
  overrides: Partial<DashboardQueries> = {},
): DashboardQueries => ({
  memberCounts: async () => [
    { provider: 'mock', key: 'ACTIVE', value: 2 },
    { provider: 'mock', key: 'INACTIVE', value: 1 },
  ],
  snapshotCounts: async () => [
    { provider: 'mock', key: 'FRESH', value: 2 },
    { provider: 'mock', key: 'STALE', value: 1 },
  ],
  loanCounts: async () => [
    { key: 'DRAFT', value: 1 },
    { key: 'APPROVED', value: 1 },
    { key: 'RETURNED_FOR_REVISION', value: 1 },
  ],
  documentCounts: async () => [{ key: 'UPLOADED', value: 1 }],
  reviewCounts: async () => ({ total: 2, completed: 1 }),
  approvalCounts: async () => [
    {
      stage: 'MANAGER',
      status: 'PENDING',
      requiredPermission: PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
      value: 1,
    },
    {
      stage: 'CHAIRMAN',
      status: 'PENDING',
      requiredPermission: PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
      value: 1,
    },
    {
      stage: 'MANAGER',
      status: 'PENDING',
      requiredPermission: PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
      value: 99,
    },
  ],
  accessCounts: async () => ({
    users: 5,
    assignments: 5,
    permissionMappings: 18,
  }),
  auditCounts: async () => [{ key: 'SUCCESS', value: 8 }],
  integrationCounts: async () => [
    { provider: 'mock', key: 'SUCCEEDED', value: 1 },
  ],
  settingsCount: async () => 3,
  ...overrides,
})

const authenticated = (permissions: readonly string[]) => async () => ({
  ok: true as const,
  principal: {
    user: {
      id: 'dashboard-test-user',
      email: 'dashboard@example.invalid',
      name: 'Dashboard Test',
    },
    session: { expiresAt: '2026-02-01T01:00:00.000Z' },
    authorization: {
      userId: 'dashboard-test-user',
      roles: [],
      permissions: [...permissions],
    },
  },
})

const request = (path = '/api/v1/dashboard') =>
  new Request(`http://localhost${path}`, {
    headers: {
      'x-correlation-id': 'dashboard-test-correlation',
      'x-role': 'ADMIN',
      'x-permission': '*',
    },
  })

after(async () => {
  await db.$client.end()
})

test('database-backed dashboard composition matches all five capability sets', async () => {
  const expectations = [
    {
      userId: 'demo-user-chairman',
      sections: [
        'member-overview',
        'member-snapshot-health',
        'chairman-approval-queue',
        'operational-report',
      ],
    },
    {
      userId: 'demo-user-manager',
      sections: [
        'member-overview',
        'member-snapshot-health',
        'manager-approval-queue',
        'operational-report',
      ],
    },
    {
      userId: 'demo-user-credit-officer',
      sections: [
        'member-overview',
        'member-snapshot-health',
        'loan-workflow',
        'document-workload',
        'credit-review-workload',
      ],
    },
    {
      userId: 'demo-user-teller',
      sections: ['member-overview', 'member-snapshot-health'],
    },
    {
      userId: 'demo-user-admin',
      sections: [
        'access-summary',
        'audit-summary',
        'integration-status',
        'settings-summary',
      ],
    },
  ]

  for (const expectation of expectations) {
    const authorization = await resolveAuthorizationContext(expectation.userId)
    const model = await readDashboard({
      permissions: authorization.permissions,
      generatedAt,
    })
    assert.deepEqual(sectionIds(model), expectation.sections)
    assert.equal(model.context.generatedAt, generatedAt.toISOString())
    assert.equal(model.context.degraded, false)
    dashboardReadModelSchema.parse(model)
  }
})

test('real aggregations are truthful counts and expose no financial or internal records', async () => {
  const credit = await resolveAuthorizationContext('demo-user-credit-officer')
  const manager = await resolveAuthorizationContext('demo-user-manager')
  const chairman = await resolveAuthorizationContext('demo-user-chairman')
  const admin = await resolveAuthorizationContext('demo-user-admin')

  const [creditModel, managerModel, chairmanModel, adminModel] =
    await Promise.all(
      [credit, manager, chairman, admin].map(({ permissions }) =>
        readDashboard({ permissions, generatedAt }),
      ),
    )

  assert.equal(metricValue(creditModel, 'member-overview', 'total'), 10)
  assert.equal(metricValue(creditModel, 'member-snapshot-health', 'total'), 8)
  assert.equal(metricValue(creditModel, 'member-snapshot-health', 'fresh'), 6)
  assert.equal(metricValue(creditModel, 'member-snapshot-health', 'stale'), 2)
  assert.equal(metricValue(creditModel, 'loan-workflow', 'draft'), 1)
  assert.equal(metricValue(creditModel, 'document-workload', 'uploaded'), 1)
  assert.equal(metricValue(creditModel, 'credit-review-workload', 'pending'), 1)
  assert.equal(
    metricValue(creditModel, 'credit-review-workload', 'completed'),
    6,
  )
  assert.equal(
    metricValue(managerModel, 'manager-approval-queue', 'pending'),
    1,
  )
  assert.equal(
    metricValue(managerModel, 'operational-report', 'applications'),
    10,
  )
  assert.equal(
    metricValue(chairmanModel, 'chairman-approval-queue', 'pending'),
    1,
  )
  assert.equal(metricValue(adminModel, 'access-summary', 'users'), 5)
  assert.equal(metricValue(adminModel, 'audit-summary', 'events'), 8)
  assert.equal(metricValue(adminModel, 'integration-status', 'failed'), 1)
  assert.equal(metricValue(adminModel, 'settings-summary', 'configured'), 3)

  for (const model of [creditModel, managerModel, chairmanModel, adminModel]) {
    for (const dashboardSection of model.sections) {
      assert.equal(dashboardSection.source.financialSourceOfTruth, false)
      for (const dashboardMetric of dashboardSection.metrics) {
        assert.equal(dashboardMetric.unit, 'count')
      }
    }
  }

  const serialized = JSON.stringify([
    creditModel,
    managerModel,
    chairmanModel,
    adminModel,
  ])
  assert.doesNotMatch(
    serialized,
    /requestedAmount|requested_amount|outstanding|portfolio balance|income|interest|bunga|providerRequestId|sessionToken|secret/i,
  )
  assert.doesNotMatch(
    serialized,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  )
})

test('missing-role is empty and multi-role permissions compose without duplicates', async () => {
  const service = createDashboardReadModelService(fixtureQueries())
  const missing = await service({ permissions: [], generatedAt })
  assert.deepEqual(missing.sections, [])

  const multiRole = await service({
    permissions: [
      PERMISSION_CODES.MEMBER_READ,
      PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
      PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
      PERMISSION_CODES.ADMIN_USER_ACCESS,
    ],
    generatedAt,
  })
  assert.deepEqual(sectionIds(multiRole), [
    'member-overview',
    'member-snapshot-health',
    'manager-approval-queue',
    'chairman-approval-queue',
    'access-summary',
  ])
  assert.equal(new Set(sectionIds(multiRole)).size, multiRole.sections.length)
  assert.equal(metricValue(multiRole, 'manager-approval-queue', 'pending'), 1)
  assert.equal(metricValue(multiRole, 'chairman-approval-queue', 'pending'), 1)
})

test('shared aggregations execute once and section ordering is deterministic', async () => {
  let loanCalls = 0
  let approvalCalls = 0
  const service = createDashboardReadModelService(
    fixtureQueries({
      loanCounts: async () => {
        loanCalls += 1
        return [{ key: 'DRAFT', value: 1 }]
      },
      approvalCounts: async () => {
        approvalCalls += 1
        return [
          {
            stage: 'MANAGER',
            status: 'PENDING',
            requiredPermission: PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
            value: 1,
          },
          {
            stage: 'CHAIRMAN',
            status: 'PENDING',
            requiredPermission: PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
            value: 1,
          },
        ]
      },
    }),
  )
  const permissions = [
    PERMISSION_CODES.LOAN_CREATE,
    PERMISSION_CODES.REPORT_READ,
    PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
    PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
  ]
  const first = await service({ permissions, generatedAt })
  assert.deepEqual(sectionIds(first), [
    'loan-workflow',
    'manager-approval-queue',
    'chairman-approval-queue',
    'operational-report',
  ])
  assert.equal(loanCalls, 1)
  assert.equal(approvalCalls, 1)
})

test('zero data is an explicit empty section, not unavailable', async () => {
  const service = createDashboardReadModelService(
    fixtureQueries({
      memberCounts: async () => [],
      snapshotCounts: async () => [],
    }),
  )
  const model = await service({
    permissions: [PERMISSION_CODES.MEMBER_READ],
    generatedAt,
  })
  assert.deepEqual(
    model.sections.map(({ id, state }) => ({ id, state })),
    [
      { id: 'member-overview', state: 'empty' },
      { id: 'member-snapshot-health', state: 'empty' },
    ],
  )
  assert.equal(model.context.degraded, false)
})

test('snapshot failure degrades only that source and preserves Workspace data', async () => {
  const service = createDashboardReadModelService(
    fixtureQueries({
      snapshotCounts: async () => {
        throw new DashboardSourceUnavailableError()
      },
    }),
  )
  const model = await service({
    permissions: [PERMISSION_CODES.MEMBER_READ],
    generatedAt,
  })
  assert.equal(model.context.degraded, true)
  assert.deepEqual(model.context.degradedSources, ['member-core-snapshot'])
  assert.equal(model.sections[0]?.state, 'available')
  assert.deepEqual(model.sections[1], {
    id: 'member-snapshot-health',
    title: 'Cached member snapshot health',
    state: 'unavailable',
    source: {
      kind: 'provider-snapshot',
      label: 'Cached core member snapshots',
      financialSourceOfTruth: false,
    },
    metrics: [],
    unavailableReason: 'source-unavailable',
  })
  dashboardReadModelSchema.parse(model)
})

test('snapshot database failure remains an essential failure', async () => {
  const service = createDashboardReadModelService(
    fixtureQueries({
      snapshotCounts: async () => {
        throw new Error('database unavailable')
      },
    }),
  )
  await assert.rejects(
    service({ permissions: [PERMISSION_CODES.MEMBER_READ], generatedAt }),
    /database unavailable/,
  )
})

test('dashboard handler requires authentication', async () => {
  const handler = createDashboardHandler({
    authenticate: async (incoming) => ({
      ok: false,
      response: errorResponse(
        incoming,
        401,
        'UNAUTHENTICATED',
        'Autentikasi diperlukan.',
      ),
    }),
    readModel: async () => {
      throw new Error('must not run')
    },
  })
  const response = await handler({ request: request() })
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Autentikasi diperlukan.',
      correlationId: 'dashboard-test-correlation',
    },
  })
})

test('dashboard handler ignores client role and permission injection', async () => {
  const handler = createDashboardHandler({
    authenticate: authenticated([PERMISSION_CODES.MEMBER_READ]),
    readModel: createDashboardReadModelService(fixtureQueries()),
  })
  const response = await handler({
    request: request('/api/v1/dashboard?role=ADMIN&permission=*'),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = (await response.json()) as { data: DashboardReadModel }
  assert.deepEqual(sectionIds(body.data), [
    'member-overview',
    'member-snapshot-health',
  ])
  assert.equal(JSON.stringify(body).includes('access-summary'), false)
})

test('essential dashboard failure returns a safe correlated 500', async () => {
  const logs: Array<unknown> = []
  const handler = createDashboardHandler({
    authenticate: authenticated([PERMISSION_CODES.MEMBER_READ]),
    readModel: async () => {
      throw new Error('database host and secret details')
    },
    logFailure: (event) => logs.push(event),
  })
  const response = await handler({ request: request() })
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Dashboard tidak dapat dimuat.',
      correlationId: 'dashboard-test-correlation',
    },
  })
  assert.deepEqual(logs, [{ correlationId: 'dashboard-test-correlation' }])
})
