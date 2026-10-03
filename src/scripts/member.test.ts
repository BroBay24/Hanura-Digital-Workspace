import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { db } from '#/db'
import { errorResponse, methodNotAllowed } from '#/lib/auth-contract'
import {
  PERMISSION_CODES,
  resolveAuthorizationContext,
} from '#/lib/authorization'
import {
  memberDetailParamsSchema,
  memberDetailReadModelSchema,
  memberListQuerySchema,
  memberListReadModelSchema,
} from '#/lib/member-contract'
import type { MemberQueries } from '#/lib/member-service'
import {
  createMemberReadModelService,
  memberReadModelService,
  MemberSnapshotSourceUnavailableError,
} from '#/lib/member-service'
import { createMemberDetailHandler } from '#/routes/api/v1/members/$id'
import { createMemberListHandler } from '#/routes/api/v1/members'

const generatedAt = new Date('2026-01-02T09:30:00.000Z')
const firstId = '10000000-0000-4000-8000-000000000001'
const secondId = '10000000-0000-4000-8000-000000000002'

const memberRows = [
  {
    id: firstId,
    providerKey: 'mock',
    memberReference: 'MOCK-MBR-001',
    displayName: ' Anggota Demo 001 ',
    status: 'ACTIVE',
    updatedAt: new Date('2026-01-02T09:00:00.000Z'),
  },
  {
    id: secondId,
    providerKey: 'sikopdit',
    memberReference: 'SIKOPDIT-MBR-002',
    displayName: null,
    status: null,
    updatedAt: new Date('2026-01-02T09:05:00.000Z'),
  },
]

const snapshotRows = [
  {
    memberReferenceId: firstId,
    providerKey: 'sikopdit',
    fetchedAt: new Date('2026-01-02T09:10:00.000Z'),
    expiresAt: new Date('2026-01-02T10:10:00.000Z'),
    freshnessStatus: 'FRESH',
  },
]

const fixtureQueries = (
  overrides: Partial<MemberQueries> = {},
): MemberQueries => ({
  listMembers: async ({ limit, offset }) =>
    memberRows.slice(offset, offset + limit),
  countMembers: async () => memberRows.length,
  memberById: async (id) => memberRows.find((member) => member.id === id),
  latestSnapshots: async (memberIds) =>
    snapshotRows.filter(({ memberReferenceId }) =>
      memberIds.includes(memberReferenceId),
    ),
  ...overrides,
})

const request = (path: string, correlationId = 'member-test-correlation') =>
  new Request(`http://localhost${path}`, {
    headers: {
      'x-correlation-id': correlationId,
      'x-permission': '*',
      'x-role': 'ADMIN',
    },
  })

const allowed = async () => ({
  ok: true as const,
  principal: {
    user: {
      id: 'demo-user-teller',
      email: 'teller.demo@hanura.local',
      name: 'Demo Teller',
    },
    session: { expiresAt: '2026-01-02T10:00:00.000Z' },
    authorization: {
      userId: 'demo-user-teller',
      roles: ['TELLER'],
      permissions: [PERMISSION_CODES.MEMBER_READ],
    },
  },
})

const denied = (status: 401 | 403) => async (incoming: Request) => ({
  ok: false as const,
  response: errorResponse(
    incoming,
    status,
    status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
    status === 401 ? 'Autentikasi diperlukan.' : 'Akses ditolak.',
  ),
})

after(async () => {
  await db.$client.end()
})

test('member query and path contracts enforce defaults and bounded inputs', () => {
  assert.deepEqual(memberListQuerySchema.parse({}), {
    q: '',
    page: 1,
    pageSize: 20,
  })
  assert.deepEqual(
    memberListQuerySchema.parse({ q: 'demo', page: '10000', pageSize: '50' }),
    { q: 'demo', page: 10_000, pageSize: 50 },
  )

  for (const invalid of [
    { extra: 'value' },
    { q: 'x'.repeat(101) },
    { page: '0' },
    { page: '10001' },
    { page: '1.5' },
    { pageSize: '0' },
    { pageSize: '51' },
  ]) {
    assert.equal(memberListQuerySchema.safeParse(invalid).success, false)
  }

  assert.equal(
    memberDetailParamsSchema.safeParse({ id: firstId }).success,
    true,
  )
  assert.equal(
    memberDetailParamsSchema.safeParse({ id: 'not-a-uuid' }).success,
    false,
  )
})

test('member service normalizes search, bounds offsets, and preserves provenance', async () => {
  const listInputs: Array<{ query: string; limit: number; offset: number }> = []
  const countInputs: Array<string> = []
  const service = createMemberReadModelService(
    fixtureQueries({
      listMembers: async (input) => {
        listInputs.push(input)
        return memberRows.slice(input.offset, input.offset + input.limit)
      },
      countMembers: async (query) => {
        countInputs.push(query)
        return memberRows.length
      },
    }),
  )

  const firstPage = await service.list({
    q: '  Anggota   Demo  ',
    page: 1,
    pageSize: 1,
    generatedAt,
  })
  assert.deepEqual(listInputs[0], {
    query: 'Anggota Demo',
    limit: 1,
    offset: 0,
  })
  assert.deepEqual(countInputs, ['Anggota Demo'])
  assert.deepEqual(firstPage.pagination, {
    page: 1,
    pageSize: 1,
    total: 2,
    totalPages: 2,
  })
  assert.equal(firstPage.members[0]?.displayName, 'Anggota Demo 001')
  assert.equal(firstPage.members[0]?.status, 'ACTIVE')
  assert.deepEqual(firstPage.members[0]?.source, {
    kind: 'mock-cache',
    label: 'Cached core member reference',
    provider: 'mock',
    financialSourceOfTruth: false,
  })
  assert.deepEqual(firstPage.members[0]?.snapshot, {
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
  })
  memberListReadModelSchema.parse(firstPage)

  const secondPage = await service.list({
    q: '',
    page: 2,
    pageSize: 1,
    generatedAt,
  })
  assert.equal(secondPage.members[0]?.displayName, 'Nama belum tersedia')
  assert.equal(secondPage.members[0]?.status, null)
  assert.deepEqual(secondPage.members[0]?.snapshot, { state: 'missing' })

  await service.list({
    q: '',
    page: 10_000,
    pageSize: 50,
    generatedAt,
  })
  assert.deepEqual(listInputs.at(-1), { query: '', limit: 50, offset: 499_950 })
})

test('snapshot unavailability degrades safely while ordinary failures propagate', async () => {
  const unavailableService = createMemberReadModelService(
    fixtureQueries({
      latestSnapshots: async () => {
        throw new MemberSnapshotSourceUnavailableError()
      },
    }),
  )
  const degraded = await unavailableService.list({
    q: '',
    page: 1,
    pageSize: 20,
    generatedAt,
  })
  assert.deepEqual(degraded.context, {
    contractVersion: '1',
    generatedAt: generatedAt.toISOString(),
    degraded: true,
    degradedSources: ['member-core-snapshot'],
  })
  assert.deepEqual(
    degraded.members.map(({ snapshot }) => snapshot),
    [
      { state: 'unavailable', unavailableReason: 'source-unavailable' },
      { state: 'unavailable', unavailableReason: 'source-unavailable' },
    ],
  )
  memberListReadModelSchema.parse(degraded)

  const failingService = createMemberReadModelService(
    fixtureQueries({
      latestSnapshots: async () => {
        throw new Error('database unavailable')
      },
    }),
  )
  await assert.rejects(
    failingService.list({ q: '', page: 1, pageSize: 20, generatedAt }),
    /database unavailable/,
  )
})

test('database-backed member list supports search, escaped wildcards, and pagination', async () => {
  const all = await memberReadModelService.list({
    q: '',
    page: 1,
    pageSize: 50,
    generatedAt,
  })
  assert.equal(all.pagination.total, 10)
  assert.equal(all.pagination.totalPages, 1)
  assert.equal(all.members.length, 10)
  assert.deepEqual(
    all.members.map(({ memberReference }) => memberReference),
    Array.from(
      { length: 10 },
      (_, index) => `MOCK-MBR-${String(index + 1).padStart(3, '0')}`,
    ),
  )
  assert.equal(
    all.members.filter(({ snapshot }) => snapshot.state === 'present').length,
    8,
  )
  assert.equal(
    all.members.filter(({ snapshot }) => snapshot.state === 'missing').length,
    2,
  )

  const [name, reference, percent, underscore, backslash, secondPage] =
    await Promise.all([
      memberReadModelService.list({
        q: '  ANGGOTA   DEMO 003 ',
        page: 1,
        pageSize: 20,
        generatedAt,
      }),
      memberReadModelService.list({
        q: 'mock-mbr-010',
        page: 1,
        pageSize: 20,
        generatedAt,
      }),
      memberReadModelService.list({
        q: '%',
        page: 1,
        pageSize: 20,
        generatedAt,
      }),
      memberReadModelService.list({
        q: '_',
        page: 1,
        pageSize: 20,
        generatedAt,
      }),
      memberReadModelService.list({
        q: '\\',
        page: 1,
        pageSize: 20,
        generatedAt,
      }),
      memberReadModelService.list({
        q: '',
        page: 2,
        pageSize: 3,
        generatedAt,
      }),
    ])

  assert.deepEqual(
    name.members.map(({ memberReference }) => memberReference),
    ['MOCK-MBR-003'],
  )
  assert.deepEqual(
    reference.members.map(({ memberReference }) => memberReference),
    ['MOCK-MBR-010'],
  )
  assert.equal(percent.pagination.total, 0)
  assert.equal(underscore.pagination.total, 0)
  assert.equal(backslash.pagination.total, 0)
  assert.deepEqual(
    secondPage.members.map(({ memberReference }) => memberReference),
    ['MOCK-MBR-004', 'MOCK-MBR-005', 'MOCK-MBR-006'],
  )
  assert.deepEqual(secondPage.pagination, {
    page: 2,
    pageSize: 3,
    total: 10,
    totalPages: 4,
  })

  const serialized = JSON.stringify(all)
  assert.doesNotMatch(
    serialized,
    /requestedAmount|outstandingAmount|savingsSummary|loanSummary|providerRequestId/i,
  )
  for (const member of all.members) {
    assert.equal(member.source.financialSourceOfTruth, false)
    if (member.snapshot.state === 'present') {
      assert.equal(member.snapshot.source.financialSourceOfTruth, false)
    }
  }
  memberListReadModelSchema.parse(all)
})

test('member detail returns one safe member and current access matrix remains unchanged', async () => {
  const list = await memberReadModelService.list({
    q: '',
    page: 1,
    pageSize: 1,
    generatedAt,
  })
  const expected = list.members[0]
  assert.ok(expected)
  const detail = await memberReadModelService.detail({
    id: expected.id,
    generatedAt,
  })
  assert.ok(detail)
  assert.deepEqual(detail.member, expected)
  memberDetailReadModelSchema.parse(detail)
  assert.equal(
    await memberReadModelService.detail({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      generatedAt,
    }),
    undefined,
  )

  const access = await Promise.all(
    [
      'demo-user-chairman',
      'demo-user-manager',
      'demo-user-credit-officer',
      'demo-user-teller',
      'demo-user-admin',
    ].map(resolveAuthorizationContext),
  )
  assert.deepEqual(
    access.map(({ permissions }) =>
      permissions.includes(PERMISSION_CODES.MEMBER_READ),
    ),
    [true, true, true, true, false],
  )
})

test('member handlers enforce access, validation, normal statuses, and safe failures', async () => {
  let reads = 0
  const unreadable = async () => {
    reads += 1
    throw new Error('must not run')
  }
  const unauthenticated = createMemberListHandler({
    authorize: denied(401),
    readModel: unreadable,
  })
  const unauthorizedResponse = await unauthenticated({
    request: request('/api/v1/members'),
  })
  assert.equal(unauthorizedResponse.status, 401)

  const forbidden = createMemberDetailHandler({
    authorize: denied(403),
    readModel: unreadable,
  })
  const forbiddenResponse = await forbidden({
    request: request(`/api/v1/members/${firstId}`),
    params: { id: firstId },
  })
  assert.equal(forbiddenResponse.status, 403)
  assert.equal(reads, 0)

  const service = createMemberReadModelService(fixtureQueries())
  const listHandler = createMemberListHandler({
    authorize: allowed,
    readModel: service.list,
  })
  for (const path of [
    '/api/v1/members?unknown=value',
    '/api/v1/members?page=1&page=2',
    '/api/v1/members?page=0',
    '/api/v1/members?page=10001',
    '/api/v1/members?pageSize=51',
    `/api/v1/members?q=${'x'.repeat(101)}`,
  ]) {
    const response = await listHandler({ request: request(path) })
    assert.equal(response.status, 400, path)
    const body = (await response.json()) as { error: { code: string } }
    assert.equal(body.error.code, 'VALIDATION_ERROR')
  }

  const listResponse = await listHandler({
    request: request('/api/v1/members?q=demo&page=1&pageSize=1'),
  })
  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.headers.get('cache-control'), 'no-store')
  const listBody = (await listResponse.json()) as { data: unknown }
  memberListReadModelSchema.parse(listBody.data)

  const detailHandler = createMemberDetailHandler({
    authorize: allowed,
    readModel: service.detail,
  })
  const invalidDetail = await detailHandler({
    request: request('/api/v1/members/not-a-uuid'),
    params: { id: 'not-a-uuid' },
  })
  assert.equal(invalidDetail.status, 400)

  const missingDetail = await detailHandler({
    request: request('/api/v1/members/ffffffff-ffff-4fff-8fff-ffffffffffff'),
    params: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
  })
  assert.equal(missingDetail.status, 404)
  const missingBody = (await missingDetail.json()) as {
    error: { code: string; correlationId: string }
  }
  assert.deepEqual(missingBody.error, {
    code: 'NOT_FOUND',
    message: 'Anggota tidak ditemukan.',
    correlationId: 'member-test-correlation',
  })

  const detailResponse = await detailHandler({
    request: request(`/api/v1/members/${firstId}`),
    params: { id: firstId },
  })
  assert.equal(detailResponse.status, 200)
  assert.equal(detailResponse.headers.get('cache-control'), 'no-store')
  const detailBody = (await detailResponse.json()) as { data: unknown }
  memberDetailReadModelSchema.parse(detailBody.data)

  const logs: Array<unknown> = []
  const failingHandler = createMemberListHandler({
    authorize: allowed,
    readModel: async () => {
      throw new Error('database host and secret details')
    },
    logFailure: (event) => logs.push(event),
  })
  const failure = await failingHandler({
    request: request('/api/v1/members', 'member-safe-500'),
  })
  assert.equal(failure.status, 500)
  assert.deepEqual(await failure.json(), {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Daftar anggota tidak dapat dimuat.',
      correlationId: 'member-safe-500',
    },
  })
  assert.deepEqual(logs, [{ correlationId: 'member-safe-500' }])

  const unsupported = methodNotAllowed('GET, HEAD')()
  assert.equal(unsupported.status, 405)
  assert.equal(unsupported.headers.get('allow'), 'GET, HEAD')
  assert.equal(unsupported.headers.get('cache-control'), 'no-store')
})
