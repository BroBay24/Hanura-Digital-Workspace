import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import type { DashboardReadModel } from './dashboard-contract.ts'
import { dashboardReadModelSchema } from './dashboard-contract.ts'

const dashboardEnvelopeSchema = z
  .object({ data: dashboardReadModelSchema })
  .strict()

type DashboardErrorBody = {
  error?: {
    code?: string
    message?: string
    correlationId?: string
  }
}

export class DashboardApiError extends Error {
  status: number
  code: string
  correlationId?: string

  constructor(status: number, body?: DashboardErrorBody) {
    super(body?.error?.message ?? 'Dashboard tidak dapat dimuat.')
    this.name = 'DashboardApiError'
    this.status = status
    this.code = body?.error?.code ?? 'INTERNAL_ERROR'
    this.correlationId = body?.error?.correlationId
  }
}

export const dashboardQueryKey = ['dashboard', 'read-model'] as const

export const fetchDashboard = async (
  fetcher: typeof fetch = fetch,
): Promise<{ data: DashboardReadModel }> => {
  const response = await fetcher('/api/v1/dashboard', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new DashboardApiError(response.status)
  }

  if (!response.ok) {
    throw new DashboardApiError(response.status, body as DashboardErrorBody)
  }
  return dashboardEnvelopeSchema.parse(body)
}

export const useDashboard = () =>
  useQuery({
    queryKey: dashboardQueryKey,
    queryFn: () => fetchDashboard(),
    enabled: typeof window !== 'undefined',
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
