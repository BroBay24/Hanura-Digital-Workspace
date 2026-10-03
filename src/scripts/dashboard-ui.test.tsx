import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DashboardContent,
  DashboardError,
  DashboardLoading,
  DashboardSection,
} from '#/components/dashboard'
import {
  DashboardApiError,
  dashboardQueryKey,
  fetchDashboard,
} from '#/lib/dashboard-client'
import type {
  DashboardReadModel,
  DashboardSection as DashboardSectionModel,
} from '#/lib/dashboard-contract'

const metric = (key: string, label: string, value: number) => ({
  key,
  label,
  value,
  unit: 'count' as const,
})

const source = {
  kind: 'workspace' as const,
  label: 'Workspace test source',
  financialSourceOfTruth: false as const,
}

const section = (
  input: Pick<DashboardSectionModel, 'id' | 'state'> &
    Partial<
      Pick<DashboardSectionModel, 'metrics' | 'source' | 'unavailableReason'>
    >,
): DashboardSectionModel => ({
  id: input.id,
  title: 'Contract title',
  state: input.state,
  source: input.source ?? source,
  metrics: input.metrics ?? [],
  ...(input.unavailableReason
    ? { unavailableReason: input.unavailableReason }
    : {}),
})

const model = (
  sections: Array<DashboardSectionModel>,
  degraded = false,
): DashboardReadModel => ({
  context: {
    contractVersion: '1',
    generatedAt: '2026-02-01T00:00:00.000Z',
    degraded,
    degradedSources: degraded ? ['member-core-snapshot'] : [],
  },
  sections,
})

test('dashboard client uses the canonical cookie-backed endpoint and validates success', async () => {
  const requests: Array<Request> = []
  const expected = model([
    section({
      id: 'access-summary',
      state: 'available',
      metrics: [metric('users', 'Users', 5)],
    }),
  ])
  const result = await fetchDashboard(async (input, init) => {
    const request = new Request(
      new URL(String(input), 'http://localhost'),
      init,
    )
    requests.push(request)
    return Response.json({ data: expected })
  })

  assert.deepEqual(result, { data: expected })
  assert.deepEqual(dashboardQueryKey, ['dashboard', 'read-model'])
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.url.endsWith('/api/v1/dashboard'), true)
  assert.equal(requests[0]?.credentials, 'include')
  assert.equal(requests[0]?.headers.get('accept'), 'application/json')
  assert.equal(requests[0]?.url.includes('role='), false)
})

test('dashboard client exposes safe API errors and rejects invalid contracts', async () => {
  await assert.rejects(
    fetchDashboard(async () =>
      Response.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Dashboard tidak dapat dimuat.',
            correlationId: 'safe-dashboard-reference',
          },
        },
        { status: 500 },
      ),
    ),
    (error: unknown) =>
      error instanceof DashboardApiError &&
      error.status === 500 &&
      error.code === 'INTERNAL_ERROR' &&
      error.correlationId === 'safe-dashboard-reference',
  )
  await assert.rejects(
    fetchDashboard(async () => Response.json({ data: { sections: [] } })),
  )
})

test('available sections render API metrics with truthful provenance', () => {
  const markup = renderToStaticMarkup(
    <DashboardSection
      section={section({
        id: 'member-overview',
        state: 'available',
        source: {
          kind: 'mock-cache',
          label: 'Mock member cache',
          provider: 'mock',
          financialSourceOfTruth: false,
        },
        metrics: [
          metric('total', 'Member references', 10),
          metric('cached-active', 'Cached active', 9),
        ],
      })}
    />,
  )

  assert.match(markup, /data-dashboard-section="member-overview"/)
  assert.match(markup, /data-section-state="available"/)
  assert.match(markup, /<h2[^>]*>Ringkasan cache anggota<\/h2>/)
  assert.match(markup, /Data simulasi · cache/)
  assert.match(markup, /data-dashboard-metric="total"/)
  assert.match(markup, />10<\/dd>/)
  assert.doesNotMatch(markup, /saldo|portfolio|outstanding|bunga/i)
})

test('mock-derived integration records remain visibly synthetic', () => {
  const markup = renderToStaticMarkup(
    <DashboardSection
      section={section({
        id: 'integration-status',
        state: 'available',
        source: {
          kind: 'workspace-derived',
          label: 'Workspace integration records',
          provider: 'mock',
          financialSourceOfTruth: false,
        },
        metrics: [metric('succeeded', 'Succeeded', 1)],
      })}
    />,
  )
  assert.match(markup, /Data simulasi · ringkasan/)
  assert.doesNotMatch(markup, />mock</i)
})

test('empty and unavailable sections remain visually and semantically distinct', () => {
  const emptyMarkup = renderToStaticMarkup(
    <DashboardSection
      section={section({
        id: 'settings-summary',
        state: 'empty',
        metrics: [metric('configured', 'Configured', 0)],
      })}
    />,
  )
  assert.match(emptyMarkup, /data-dashboard-state="empty"/)
  assert.match(emptyMarkup, /mencatat nilai nol/)
  assert.match(emptyMarkup, />0<\/dd>/)
  assert.doesNotMatch(emptyMarkup, /sementara tidak tersedia/)

  const unavailableMarkup = renderToStaticMarkup(
    <DashboardSection
      section={section({
        id: 'member-snapshot-health',
        state: 'unavailable',
        source: {
          kind: 'provider-snapshot',
          label: 'Provider snapshot',
          financialSourceOfTruth: false,
        },
        unavailableReason: 'source-unavailable',
      })}
    />,
  )
  assert.match(unavailableMarkup, /data-dashboard-state="unavailable"/)
  assert.match(unavailableMarkup, /Sumber data sementara tidak tersedia/)
  assert.match(unavailableMarkup, /berbeda dari nol/)
  assert.doesNotMatch(unavailableMarkup, /<dd/)
})

test('degraded dashboards preserve available sections and omitted sections stay absent', () => {
  const markup = renderToStaticMarkup(
    <DashboardContent
      model={model(
        [
          section({
            id: 'member-overview',
            state: 'available',
            metrics: [metric('total', 'Members', 10)],
          }),
          section({
            id: 'member-snapshot-health',
            state: 'unavailable',
            source: {
              kind: 'provider-snapshot',
              label: 'Provider snapshot',
              financialSourceOfTruth: false,
            },
            unavailableReason: 'source-unavailable',
          }),
        ],
        true,
      )}
    />,
  )
  assert.match(markup, /data-dashboard-degraded="true"/)
  assert.match(markup, /Ringkasan Workspace tetap dapat digunakan/)
  assert.match(markup, /data-dashboard-section="member-overview"/)
  assert.match(markup, /data-dashboard-section="member-snapshot-health"/)
  assert.doesNotMatch(markup, /data-dashboard-section="access-summary"/)
})

test('no-section dashboard is explicit and does not manufacture cards', () => {
  const markup = renderToStaticMarkup(<DashboardContent model={model([])} />)
  assert.match(markup, /data-dashboard-empty="true"/)
  assert.match(markup, /Belum ada ringkasan yang tersedia/)
  assert.doesNotMatch(markup, /data-dashboard-section=/)
})

test('loading and error states are accessible and contain no fake metrics', () => {
  const loading = renderToStaticMarkup(<DashboardLoading />)
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /role="status"/)
  assert.match(loading, /Memuat ringkasan dashboard…/)
  assert.doesNotMatch(loading, /data-dashboard-metric=/)

  const error = renderToStaticMarkup(
    <DashboardError onRetry={() => undefined} />,
  )
  assert.match(error, /role="alert"/)
  assert.match(error, /<h2[^>]*>Dashboard tidak dapat dimuat<\/h2>/)
  assert.match(error, /Coba lagi/)
  assert.doesNotMatch(error, /stack|correlation|database/i)
})

test('dashboard frontend has no direct database or role-policy implementation', async () => {
  const files = [
    new URL('../components/dashboard.tsx', import.meta.url),
    new URL('../lib/dashboard-client.ts', import.meta.url),
    new URL('../routes/_authenticated.index.tsx', import.meta.url),
  ]
  const sourceText = (
    await Promise.all(files.map((file) => readFile(file, 'utf8')))
  ).join('\n')
  assert.doesNotMatch(sourceText, /#\/db|drizzle-orm|#\/db\/schema/)
  assert.doesNotMatch(
    sourceText,
    /role\s*===|roles\.includes|CHAIRMAN|MANAGER|CREDIT_OFFICER|TELLER|ADMIN/,
  )
  assert.doesNotMatch(sourceText, /Math\.random|requestedAmount/)
})
