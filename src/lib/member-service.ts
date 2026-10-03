import { asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import { memberCoreSnapshots, memberReferences } from '#/db/schema'
import type {
  MemberDetailReadModel,
  MemberListQuery,
  MemberListReadModel,
  MemberSummary,
} from './member-contract.ts'

export class MemberSnapshotSourceUnavailableError extends Error {
  constructor() {
    super('Member snapshot source unavailable')
    this.name = 'MemberSnapshotSourceUnavailableError'
  }
}

type MemberRow = {
  id: string
  providerKey: string
  memberReference: string
  displayName: string | null
  status: string | null
  updatedAt: Date
}

type SnapshotRow = {
  memberReferenceId: string
  providerKey: string
  fetchedAt: Date
  expiresAt: Date | null
  freshnessStatus: string
}

export type MemberQueries = {
  listMembers: (input: {
    query: string
    limit: number
    offset: number
  }) => Promise<Array<MemberRow>>
  countMembers: (query: string) => Promise<number>
  memberById: (id: string) => Promise<MemberRow | undefined>
  latestSnapshots: (memberIds: readonly string[]) => Promise<Array<SnapshotRow>>
}

const searchCondition = (query: string) => {
  if (!query) return undefined
  const escaped = query
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
  const pattern = `%${escaped.toLowerCase()}%`
  return or(
    sql<boolean>`lower(coalesce(${memberReferences.displayNameCache}, '')) like ${pattern} escape '\\'`,
    sql<boolean>`lower(${memberReferences.coreMemberId}) like ${pattern} escape '\\'`,
  )
}

const defaultMemberQueries: MemberQueries = {
  listMembers: async ({ query, limit, offset }) => {
    const condition = searchCondition(query)
    const base = db
      .select({
        id: memberReferences.id,
        providerKey: memberReferences.providerKey,
        memberReference: memberReferences.coreMemberId,
        displayName: memberReferences.displayNameCache,
        status: memberReferences.statusCache,
        updatedAt: memberReferences.updatedAt,
      })
      .from(memberReferences)
    return (condition ? base.where(condition) : base)
      .orderBy(
        asc(memberReferences.displayNameCache),
        asc(memberReferences.coreMemberId),
        asc(memberReferences.id),
      )
      .limit(limit)
      .offset(offset)
  },
  countMembers: async (query) => {
    const condition = searchCondition(query)
    const base = db.select({ value: count() }).from(memberReferences)
    const rows = await (condition ? base.where(condition) : base)
    return rows[0]?.value ?? 0
  },
  memberById: async (id) => {
    const rows = await db
      .select({
        id: memberReferences.id,
        providerKey: memberReferences.providerKey,
        memberReference: memberReferences.coreMemberId,
        displayName: memberReferences.displayNameCache,
        status: memberReferences.statusCache,
        updatedAt: memberReferences.updatedAt,
      })
      .from(memberReferences)
      .where(eq(memberReferences.id, id))
      .limit(1)
    return rows[0]
  },
  latestSnapshots: async (memberIds) => {
    if (memberIds.length === 0) return []
    const ranked = db
      .select({
        memberReferenceId: memberCoreSnapshots.memberReferenceId,
        providerKey: memberCoreSnapshots.providerKey,
        fetchedAt: memberCoreSnapshots.fetchedAt,
        expiresAt: memberCoreSnapshots.expiresAt,
        freshnessStatus: memberCoreSnapshots.freshnessStatus,
        rank: sql<number>`row_number() over (
          partition by ${memberCoreSnapshots.memberReferenceId}
          order by ${memberCoreSnapshots.fetchedAt} desc, ${memberCoreSnapshots.id} desc
        )`.as('snapshot_rank'),
      })
      .from(memberCoreSnapshots)
      .where(inArray(memberCoreSnapshots.memberReferenceId, [...memberIds]))
      .as('ranked_member_snapshots')
    return db
      .select({
        memberReferenceId: ranked.memberReferenceId,
        providerKey: ranked.providerKey,
        fetchedAt: ranked.fetchedAt,
        expiresAt: ranked.expiresAt,
        freshnessStatus: ranked.freshnessStatus,
      })
      .from(ranked)
      .where(eq(ranked.rank, 1))
      .orderBy(desc(ranked.fetchedAt), asc(ranked.memberReferenceId))
  },
}

const normalizeQuery = (query: string) => query.trim().replace(/\s+/g, ' ')

const freshness = (value: string): 'fresh' | 'stale' | 'unknown' => {
  if (value === 'FRESH') return 'fresh'
  if (value === 'STALE') return 'stale'
  return 'unknown'
}

const source = (
  providerKey: string,
  kind: 'cache' | 'snapshot',
): MemberSummary['source'] => ({
  kind:
    providerKey === 'mock'
      ? kind === 'cache'
        ? 'mock-cache'
        : 'mock-snapshot'
      : kind === 'cache'
        ? 'provider-cache'
        : 'provider-snapshot',
  label:
    kind === 'cache'
      ? 'Cached core member reference'
      : 'Cached core member snapshot',
  provider: providerKey,
  financialSourceOfTruth: false,
})

const summary = (
  member: MemberRow,
  snapshot: SnapshotRow | undefined,
  snapshotUnavailable: boolean,
): MemberSummary => ({
  id: member.id,
  displayName: member.displayName?.trim() || 'Nama belum tersedia',
  memberReference: member.memberReference,
  status: member.status,
  source: source(member.providerKey, 'cache'),
  snapshot: snapshotUnavailable
    ? { state: 'unavailable', unavailableReason: 'source-unavailable' }
    : snapshot
      ? {
          state: 'present',
          freshness: freshness(snapshot.freshnessStatus),
          fetchedAt: snapshot.fetchedAt.toISOString(),
          expiresAt: snapshot.expiresAt?.toISOString() ?? null,
          source: source(snapshot.providerKey, 'snapshot'),
        }
      : { state: 'missing' },
  updatedAt: member.updatedAt.toISOString(),
})

const snapshotMap = async (
  queries: MemberQueries,
  memberIds: readonly string[],
) => {
  try {
    const rows = await queries.latestSnapshots(memberIds)
    return {
      snapshots: new Map(rows.map((row) => [row.memberReferenceId, row])),
      unavailable: false,
    }
  } catch (error) {
    if (!(error instanceof MemberSnapshotSourceUnavailableError)) throw error
    return {
      snapshots: new Map<string, SnapshotRow>(),
      unavailable: true,
    }
  }
}

const context = (generatedAt: Date, degraded: boolean) => ({
  contractVersion: '1' as const,
  generatedAt: generatedAt.toISOString(),
  degraded,
  degradedSources: degraded ? ['member-core-snapshot' as const] : [],
})

export const createMemberReadModelService = (
  queries: MemberQueries = defaultMemberQueries,
) => ({
  list: async (
    input: MemberListQuery & { generatedAt?: Date },
  ): Promise<MemberListReadModel> => {
    const query = normalizeQuery(input.q)
    const offset = (input.page - 1) * input.pageSize
    const [members, total] = await Promise.all([
      queries.listMembers({ query, limit: input.pageSize, offset }),
      queries.countMembers(query),
    ])
    const snapshots = await snapshotMap(
      queries,
      members.map(({ id }) => id),
    )
    return {
      context: context(input.generatedAt ?? new Date(), snapshots.unavailable),
      query,
      members: members.map((member) =>
        summary(
          member,
          snapshots.snapshots.get(member.id),
          snapshots.unavailable,
        ),
      ),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
    }
  },
  detail: async (input: {
    id: string
    generatedAt?: Date
  }): Promise<MemberDetailReadModel | undefined> => {
    const member = await queries.memberById(input.id)
    if (!member) return undefined
    const snapshots = await snapshotMap(queries, [member.id])
    return {
      context: context(input.generatedAt ?? new Date(), snapshots.unavailable),
      member: summary(
        member,
        snapshots.snapshots.get(member.id),
        snapshots.unavailable,
      ),
    }
  },
})

export const memberReadModelService = createMemberReadModelService()
