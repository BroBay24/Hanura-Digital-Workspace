import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import type { MemberListQuery, MemberListReadModel } from './member-contract.ts'
import { memberListReadModelSchema } from './member-contract.ts'

const memberListEnvelopeSchema = z
  .object({ data: memberListReadModelSchema })
  .strict()

type MemberErrorBody = {
  error?: {
    code?: string
    message?: string
    correlationId?: string
  }
}

export type MemberListInput = Pick<MemberListQuery, 'q' | 'page' | 'pageSize'>

export const memberDirectorySearchSchema = z.object({
  q: z
    .string()
    .max(100)
    .catch('')
    .transform((value) => value.trim().replace(/\s+/g, ' ')),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
})

export class MemberApiError extends Error {
  status: number
  code: string
  correlationId?: string

  constructor(status: number, body?: MemberErrorBody) {
    super(body?.error?.message ?? 'Daftar anggota tidak dapat dimuat.')
    this.name = 'MemberApiError'
    this.status = status
    this.code = body?.error?.code ?? 'INTERNAL_ERROR'
    this.correlationId = body?.error?.correlationId
  }
}

export const normalizeMemberSearch = (value: string) =>
  value.trim().replace(/\s+/g, ' ')

export const memberQueryKey = ['members'] as const

export const memberListQueryKey = (input: MemberListInput) =>
  [
    ...memberQueryKey,
    'list',
    {
      q: normalizeMemberSearch(input.q),
      page: input.page,
      pageSize: input.pageSize,
    },
  ] as const

export const fetchMemberList = async (
  input: MemberListInput,
  fetcher: typeof fetch = fetch,
): Promise<{ data: MemberListReadModel }> => {
  const parameters = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
  })
  const query = normalizeMemberSearch(input.q)
  if (query) parameters.set('q', query)

  const response = await fetcher(`/api/v1/members?${parameters}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new MemberApiError(response.status)
  }

  if (!response.ok) {
    throw new MemberApiError(response.status, body as MemberErrorBody)
  }
  return memberListEnvelopeSchema.parse(body)
}

export const useMemberList = (input: MemberListInput, enabled: boolean) =>
  useQuery({
    queryKey: memberListQueryKey(input),
    queryFn: () => fetchMemberList(input),
    enabled: enabled && typeof window !== 'undefined',
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
