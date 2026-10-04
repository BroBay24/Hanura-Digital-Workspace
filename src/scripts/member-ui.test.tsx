import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MemberDirectoryContent,
  MemberEmpty,
  MemberError,
  MemberForbidden,
  MemberLoading,
} from '#/components/members'
import {
  fetchMemberList,
  MemberApiError,
  memberDirectorySearchSchema,
  memberListQueryKey,
  memberQueryKey,
  normalizeMemberSearch,
} from '#/lib/member-client'
import type { MemberListReadModel, MemberSummary } from '#/lib/member-contract'

const presentMember: MemberSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  displayName: 'Anggota Demo 001',
  memberReference: 'MOCK-MBR-001',
  status: 'ACTIVE',
  source: {
    kind: 'mock-cache',
    label: 'Cached core member reference',
    provider: 'mock',
    financialSourceOfTruth: false,
  },
  snapshot: {
    state: 'present',
    freshness: 'fresh',
    fetchedAt: '2026-01-02T09:10:00.000Z',
    expiresAt: '2026-01-02T10:10:00.000Z',
    source: {
      kind: 'provider-snapshot',
      label: 'Cached core member snapshot',
      provider: 'sikopdit',
      financialSourceOfTruth: false,
    },
  },
  updatedAt: '2026-01-02T09:00:00.000Z',
}

const missingMember: MemberSummary = {
  id: '10000000-0000-4000-8000-000000000002',
  displayName: 'Nama belum tersedia',
  memberReference: 'SIKOPDIT-MBR-002',
  status: null,
  source: {
    kind: 'provider-cache',
    label: 'Cached core member reference',
    provider: 'sikopdit',
    financialSourceOfTruth: false,
  },
  snapshot: { state: 'missing' },
  updatedAt: '2026-01-02T09:05:00.000Z',
}

const model = (
  members: Array<MemberSummary>,
  options: {
    degraded?: boolean
    page?: number
    pageSize?: number
    query?: string
    total?: number
    totalPages?: number
  } = {},
): MemberListReadModel => ({
  context: {
    contractVersion: '1',
    generatedAt: '2026-01-02T09:30:00.000Z',
    degraded: options.degraded ?? false,
    degradedSources: options.degraded ? ['member-core-snapshot'] : [],
  },
  query: options.query ?? '',
  members,
  pagination: {
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 20,
    total: options.total ?? members.length,
    totalPages:
      options.totalPages ??
      (members.length === 0 ? 0 : Math.ceil(members.length / 20)),
  },
})

test('member client uses canonical cookie-backed server pagination and isolated query keys', async () => {
  const requests: Array<Request> = []
  const expected = model([presentMember], {
    page: 2,
    pageSize: 20,
    query: 'Anggota Demo',
    total: 21,
    totalPages: 2,
  })
  const result = await fetchMemberList(
    { q: '  Anggota   Demo  ', page: 2, pageSize: 20 },
    async (input, init) => {
      requests.push(
        new Request(new URL(String(input), 'http://localhost'), init),
      )
      return Response.json({ data: expected })
    },
  )

  assert.deepEqual(result, { data: expected })
  assert.deepEqual(memberQueryKey, ['members'])
  assert.deepEqual(
    memberListQueryKey({ q: ' Anggota   Demo ', page: 2, pageSize: 20 }),
    ['members', 'list', { q: 'Anggota Demo', page: 2, pageSize: 20 }],
  )
  assert.equal(normalizeMemberSearch('  Anggota   Demo  '), 'Anggota Demo')
  assert.deepEqual(
    memberDirectorySearchSchema.parse({ q: 'x'.repeat(101), page: 0 }),
    {
      q: '',
      page: 1,
    },
  )
  assert.equal(requests.length, 1)
  assert.equal(
    requests[0]?.url.endsWith(
      '/api/v1/members?page=2&pageSize=20&q=Anggota+Demo',
    ),
    true,
  )
  assert.equal(requests[0]?.credentials, 'include')
  assert.equal(requests[0]?.headers.get('accept'), 'application/json')
  assert.equal(requests[0]?.url.includes('role='), false)
})

test('member client exposes safe API errors and rejects invalid contracts', async () => {
  await assert.rejects(
    fetchMemberList({ q: '', page: 1, pageSize: 20 }, async () =>
      Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Akses ditolak.',
            correlationId: 'member-ui-safe-reference',
          },
        },
        { status: 403 },
      ),
    ),
    (error: unknown) =>
      error instanceof MemberApiError &&
      error.status === 403 &&
      error.code === 'FORBIDDEN' &&
      error.correlationId === 'member-ui-safe-reference',
  )
  await assert.rejects(
    fetchMemberList({ q: '', page: 1, pageSize: 20 }, async () =>
      Response.json({ data: { members: [] } }),
    ),
  )
})

test('member directory renders only safe API summaries with semantic desktop and narrow layouts', () => {
  const markup = renderToStaticMarkup(
    <MemberDirectoryContent
      model={model([presentMember, missingMember], {
        pageSize: 2,
        total: 4,
        totalPages: 2,
      })}
      onClear={() => undefined}
      onPageChange={() => undefined}
    />,
  )

  assert.match(markup, /<table/)
  assert.match(markup, /<caption[^>]*>Daftar anggota/)
  assert.match(markup, /<th scope="col"[^>]*>ID anggota/)
  assert.match(markup, /<ul[^>]*aria-label="Daftar anggota"/)
  assert.match(markup, /data-member-row="MOCK-MBR-001"/)
  assert.match(markup, /Anggota Demo 001/)
  assert.match(markup, /SIKOPDIT-MBR-002/)
  assert.match(markup, /Snapshot tersedia/)
  assert.match(markup, /Snapshot belum tersimpan/)
  assert.match(markup, /Data simulasi · cache/)
  assert.match(markup, /Data penyedia · snapshot/)
  assert.match(markup, /aria-label="Paginasi anggota"/)
  assert.match(markup, /Halaman <strong[^>]*>1<\/strong> dari/)
  assert.doesNotMatch(
    markup,
    /savings|saldo|outstanding|loan balance|transaction|providerRequestId|10000000-0000/i,
  )
})

test('loading, empty directory, no-result, error, and forbidden states remain distinct', () => {
  const loading = renderToStaticMarkup(<MemberLoading />)
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /role="status"/)
  assert.match(loading, /Memuat daftar anggota…/)
  assert.doesNotMatch(loading, /data-member-row=/)

  const emptyDirectory = renderToStaticMarkup(
    <MemberEmpty
      page={1}
      query=""
      total={0}
      onClear={() => undefined}
      onPageChange={() => undefined}
    />,
  )
  assert.match(emptyDirectory, /data-members-empty="directory"/)
  assert.match(emptyDirectory, /Direktori anggota masih kosong/)
  assert.doesNotMatch(emptyDirectory, /Tidak ada hasil untuk/)

  const noResults = renderToStaticMarkup(
    <MemberEmpty
      page={1}
      query="tidak ada"
      total={0}
      onClear={() => undefined}
      onPageChange={() => undefined}
    />,
  )
  assert.match(noResults, /data-members-empty="search"/)
  assert.match(noResults, /Anggota tidak ditemukan/)
  assert.match(noResults, /Hapus pencarian/)
  assert.doesNotMatch(noResults, /masih kosong/)

  const emptyPage = renderToStaticMarkup(
    <MemberEmpty
      page={3}
      query=""
      total={10}
      onClear={() => undefined}
      onPageChange={() => undefined}
    />,
  )
  assert.match(emptyPage, /data-members-empty="page"/)
  assert.match(emptyPage, /Halaman anggota tidak berisi data/)
  assert.match(emptyPage, /Kembali ke halaman pertama/)
  assert.doesNotMatch(emptyPage, /masih kosong/)

  const error = renderToStaticMarkup(
    <MemberError
      error={new Error('private infrastructure')}
      onRetry={() => undefined}
    />,
  )
  assert.match(error, /role="alert"/)
  assert.match(error, /Direktori anggota tidak dapat dimuat/)
  assert.match(error, /Coba lagi/)
  assert.doesNotMatch(error, /private infrastructure|database|correlation/i)

  const forbidden = renderToStaticMarkup(<MemberForbidden />)
  assert.match(forbidden, /data-members-forbidden="true"/)
  assert.match(forbidden, /Akses anggota ditolak/)
  assert.doesNotMatch(forbidden, /data-member-row=/)
})

test('degraded snapshot keeps member identity usable and reports unavailable data truthfully', () => {
  const degradedMember: MemberSummary = {
    ...presentMember,
    snapshot: {
      state: 'unavailable',
      unavailableReason: 'source-unavailable',
    },
  }
  const markup = renderToStaticMarkup(
    <MemberDirectoryContent
      model={model([degradedMember], { degraded: true })}
      onClear={() => undefined}
      onPageChange={() => undefined}
    />,
  )

  assert.match(markup, /data-members-degraded="true"/)
  assert.match(markup, /Sebagian snapshot data belum tersedia/)
  assert.match(markup, /data-member-row="MOCK-MBR-001"/)
  assert.match(markup, /Sumber snapshot sedang bermasalah/)
  assert.match(markup, /data-member-snapshot-state="unavailable"/)
})

test('member frontend has no direct database, raw payload, financial, or role-policy implementation', async () => {
  const files = [
    new URL('../components/members.tsx', import.meta.url),
    new URL('../lib/member-client.ts', import.meta.url),
    new URL('../routes/_authenticated.members.tsx', import.meta.url),
  ]
  const sourceText = (
    await Promise.all(files.map((file) => readFile(file, 'utf8')))
  ).join('\n')

  assert.doesNotMatch(
    sourceText,
    /#\/db|drizzle-orm|#\/db\/schema|memberCoreSnapshots/,
  )
  assert.doesNotMatch(
    sourceText,
    /role\s*===|roles\.includes|CHAIRMAN|MANAGER|CREDIT_OFFICER|TELLER|ADMIN/,
  )
  assert.doesNotMatch(
    sourceText,
    /requestedAmount|outstandingAmount|savingsSummary|loanSummary|providerRequestId/,
  )
  assert.doesNotMatch(sourceText, /\/api\/v1\/members\/[^?`'"]+/)
})
