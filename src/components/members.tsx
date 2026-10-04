import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { MemberListReadModel, MemberSummary } from '#/lib/member-contract'
import type { MemberListInput } from '#/lib/member-client'
import {
  MemberApiError,
  normalizeMemberSearch,
  useMemberList,
} from '#/lib/member-client'

const statusCopy = (status: string | null) => {
  if (status === 'ACTIVE') return { label: 'Aktif', tone: 'active' }
  if (status === 'INACTIVE') return { label: 'Tidak aktif', tone: 'inactive' }
  return { label: 'Belum diketahui', tone: 'unknown' }
}

const snapshotCopy = (snapshot: MemberSummary['snapshot']) => {
  if (snapshot.state === 'missing') {
    return { label: 'Belum tersedia', detail: 'Snapshot belum tersimpan' }
  }
  if (snapshot.state === 'unavailable') {
    return {
      label: 'Tidak tersedia',
      detail: 'Sumber snapshot sedang bermasalah',
    }
  }
  const label =
    snapshot.freshness === 'fresh'
      ? 'Snapshot tersedia'
      : snapshot.freshness === 'stale'
        ? 'Perlu diperbarui'
        : 'Status belum diketahui'
  return {
    label,
    detail:
      snapshot.source.kind === 'mock-snapshot'
        ? 'Data simulasi · snapshot'
        : 'Data penyedia · snapshot',
  }
}

const memberSourceCopy = (member: MemberSummary) =>
  member.source.kind === 'mock-cache'
    ? 'Data simulasi · cache'
    : 'Data penyedia · cache'

export function MemberDirectoryPage({
  canReadMembers,
  search,
}: {
  canReadMembers: boolean
  search: MemberListInput
}) {
  const navigate = useNavigate({ from: '/members' })
  const [draft, setDraft] = useState(search.q)
  const memberQuery = useMemberList(search, canReadMembers)

  useEffect(() => setDraft(search.q), [search.q])

  const updateSearch = (next: MemberListInput) =>
    navigate({
      search: {
        q: next.q,
        page: next.page,
      },
    })

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void updateSearch({
      q: normalizeMemberSearch(draft),
      page: 1,
      pageSize: search.pageSize,
    })
  }

  const clearSearch = () => {
    setDraft('')
    void updateSearch({ q: '', page: 1, pageSize: search.pageSize })
  }

  if (!canReadMembers) return <MemberForbidden />
  if (memberQuery.isPending) {
    return (
      <MemberDirectoryLayout
        draft={draft}
        onDraftChange={setDraft}
        onSearch={submitSearch}
        onClear={clearSearch}
      >
        <MemberLoading />
      </MemberDirectoryLayout>
    )
  }
  if (memberQuery.isError) {
    return (
      <MemberDirectoryLayout
        draft={draft}
        onDraftChange={setDraft}
        onSearch={submitSearch}
        onClear={clearSearch}
      >
        <MemberError
          error={memberQuery.error}
          onRetry={() => void memberQuery.refetch()}
        />
      </MemberDirectoryLayout>
    )
  }

  const model = memberQuery.data.data
  return (
    <MemberDirectoryLayout
      draft={draft}
      onDraftChange={setDraft}
      onSearch={submitSearch}
      onClear={clearSearch}
      busy={memberQuery.isFetching}
    >
      <MemberDirectoryContent
        model={model}
        isRefreshing={memberQuery.isFetching}
        onClear={clearSearch}
        onPageChange={(page) =>
          void updateSearch({ ...search, q: model.query, page })
        }
      />
    </MemberDirectoryLayout>
  )
}

function MemberDirectoryLayout({
  busy = false,
  children,
  draft,
  onClear,
  onDraftChange,
  onSearch,
}: {
  busy?: boolean
  children: React.ReactNode
  draft: string
  onClear: () => void
  onDraftChange: (value: string) => void
  onSearch: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div data-members-page="true" className="mx-auto max-w-[1120px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[28px] leading-[41px] font-semibold">Anggota</h2>
          <p className="mt-1 text-xs leading-[19px] text-[#64748b]">
            Cari referensi anggota yang tersedia di Workspace.
          </p>
        </div>
      </div>

      <form
        role="search"
        onSubmit={onSearch}
        className="rounded-2xl border border-[#e2e8f0] bg-white p-4"
      >
        <label
          htmlFor="member-search"
          className="text-[11px] leading-4 font-medium text-[#64748b]"
        >
          Cari anggota
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748b]"
            />
            <input
              id="member-search"
              type="search"
              maxLength={100}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Cari berdasarkan nama atau ID anggota…"
              className="h-11 w-full rounded-xl border border-[#cbd5e1] bg-white pr-10 pl-10 text-sm outline-none placeholder:text-[#94a3b8] focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
            />
            {draft ? (
              <button
                type="button"
                aria-label="Hapus pencarian"
                onClick={onClear}
                className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#64748b] hover:bg-[#f1f5f9] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2563eb]"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            className="h-11 rounded-xl bg-[#2563eb] px-5 text-sm font-medium text-white hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
          >
            Cari
          </button>
        </div>
      </form>

      {busy ? (
        <p role="status" aria-live="polite" className="sr-only">
          Memperbarui daftar anggota…
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </div>
  )
}

export function MemberDirectoryContent({
  isRefreshing = false,
  model,
  onClear,
  onPageChange,
}: {
  isRefreshing?: boolean
  model: MemberListReadModel
  onClear: () => void
  onPageChange: (page: number) => void
}) {
  if (model.members.length === 0) {
    return (
      <MemberEmpty
        page={model.pagination.page}
        query={model.query}
        total={model.pagination.total}
        onClear={onClear}
        onPageChange={onPageChange}
      />
    )
  }

  return (
    <section aria-labelledby="member-directory-title">
      {model.context.degraded ? <MemberDegraded /> : null}
      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-4 py-3 sm:px-5">
          <div>
            <h2 id="member-directory-title" className="text-sm font-semibold">
              Direktori anggota
            </h2>
            <p className="mt-1 text-xs text-[#64748b]">
              {model.pagination.total.toLocaleString('id-ID')} anggota ditemukan
            </p>
          </div>
          {isRefreshing ? (
            <span className="text-xs text-[#64748b]">Memperbarui…</span>
          ) : null}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">
              Daftar anggota sesuai hasil pencarian dan halaman aktif
            </caption>
            <thead className="bg-[#f8fafc] text-[11px] font-medium text-[#64748b]">
              <tr>
                <th scope="col" className="px-5 py-3">
                  ID anggota
                </th>
                <th scope="col" className="px-5 py-3">
                  Nama
                </th>
                <th scope="col" className="px-5 py-3">
                  Status
                </th>
                <th scope="col" className="px-5 py-3">
                  Snapshot data
                </th>
                <th scope="col" className="px-5 py-3">
                  Sumber
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              {model.members.map((member) => (
                <MemberTableRow key={member.id} member={member} />
              ))}
            </tbody>
          </table>
        </div>

        <ul
          className="divide-y divide-[#e2e8f0] md:hidden"
          aria-label="Daftar anggota"
        >
          {model.members.map((member) => (
            <MemberCard key={member.id} member={member} />
          ))}
        </ul>

        <MemberPagination
          pagination={model.pagination}
          disabled={isRefreshing}
          onPageChange={onPageChange}
        />
      </div>
    </section>
  )
}

function MemberTableRow({ member }: { member: MemberSummary }) {
  const status = statusCopy(member.status)
  const snapshot = snapshotCopy(member.snapshot)
  return (
    <tr data-member-row={member.memberReference} className="hover:bg-[#f8fafc]">
      <td className="px-5 py-4 text-xs font-medium whitespace-nowrap text-[#2563eb]">
        {member.memberReference}
      </td>
      <td className="px-5 py-4 text-sm font-medium">{member.displayName}</td>
      <td className="px-5 py-4">
        <StatusBadge label={status.label} tone={status.tone} />
      </td>
      <td
        className="px-5 py-4"
        data-member-snapshot-state={member.snapshot.state}
      >
        <p className="text-xs font-medium">{snapshot.label}</p>
        <p className="mt-1 text-[11px] text-[#64748b]">{snapshot.detail}</p>
      </td>
      <td className="px-5 py-4 text-xs text-[#64748b]">
        {memberSourceCopy(member)}
      </td>
    </tr>
  )
}

function MemberCard({ member }: { member: MemberSummary }) {
  const status = statusCopy(member.status)
  const snapshot = snapshotCopy(member.snapshot)
  return (
    <li data-member-row={member.memberReference} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{member.displayName}</p>
          <p className="mt-1 text-xs font-medium text-[#2563eb]">
            {member.memberReference}
          </p>
        </div>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      <dl className="mt-4 grid gap-3 text-xs">
        <div data-member-snapshot-state={member.snapshot.state}>
          <dt className="text-[11px] text-[#64748b]">Snapshot data</dt>
          <dd className="mt-1 font-medium">{snapshot.label}</dd>
          <dd className="mt-1 text-[11px] text-[#64748b]">{snapshot.detail}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-[#64748b]">Sumber</dt>
          <dd className="mt-1">{memberSourceCopy(member)}</dd>
        </div>
      </dl>
    </li>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: string }) {
  const colors =
    tone === 'active'
      ? 'border-[#86efac] bg-[#f0fdf4] text-[#166534]'
      : tone === 'inactive'
        ? 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569]'
        : 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]'
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium ${colors}`}
    >
      {label}
    </span>
  )
}

function MemberPagination({
  disabled,
  onPageChange,
  pagination,
}: {
  disabled: boolean
  onPageChange: (page: number) => void
  pagination: MemberListReadModel['pagination']
}) {
  const lastPage = Math.max(1, pagination.totalPages)
  return (
    <nav
      aria-label="Paginasi anggota"
      className="flex flex-col gap-3 border-t border-[#e2e8f0] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <p className="text-xs text-[#64748b]" aria-live="polite">
        <span aria-current="page">
          Halaman <strong className="text-[#0f172a]">{pagination.page}</strong>{' '}
          dari <strong className="text-[#0f172a]">{lastPage}</strong>
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled || pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
          className="rounded-xl border border-[#cbd5e1] px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
        >
          Sebelumnya
        </button>
        <button
          type="button"
          disabled={disabled || pagination.page >= lastPage}
          onClick={() => onPageChange(pagination.page + 1)}
          className="rounded-xl border border-[#cbd5e1] px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
        >
          Berikutnya
        </button>
      </div>
    </nav>
  )
}

export function MemberLoading() {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      data-members-loading="true"
      className="rounded-2xl border border-[#e2e8f0] bg-white p-5"
    >
      <h2 className="sr-only">Memuat direktori anggota</h2>
      <p role="status" className="sr-only">
        Memuat daftar anggota…
      </p>
      <div aria-hidden="true" className="space-y-4">
        <div className="h-5 w-40 animate-pulse rounded-full bg-[#e2e8f0]" />
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-14 animate-pulse rounded-xl bg-[#f1f5f9]"
          />
        ))}
      </div>
    </section>
  )
}

export function MemberEmpty({
  onClear,
  onPageChange,
  page,
  query,
  total,
}: {
  onClear: () => void
  onPageChange: (page: number) => void
  page: number
  query: string
  total: number
}) {
  const noResults = Boolean(query) && total === 0
  const emptyPage = total > 0
  const state = emptyPage ? 'page' : noResults ? 'search' : 'directory'
  return (
    <section
      data-members-empty={state}
      aria-labelledby="members-empty-title"
      className="rounded-2xl border border-[#e2e8f0] bg-white p-6 sm:p-7"
    >
      <h2 id="members-empty-title" className="text-xl font-semibold">
        {noResults
          ? 'Anggota tidak ditemukan'
          : emptyPage
            ? 'Halaman anggota tidak berisi data'
            : 'Direktori anggota masih kosong'}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#64748b]">
        {noResults
          ? `Tidak ada hasil untuk “${query}”. Periksa ejaan atau hapus pencarian.`
          : emptyPage
            ? `Halaman ${page} berada di luar hasil yang tersedia.`
            : 'Belum ada referensi anggota yang tersedia di Workspace.'}
      </p>
      {noResults || emptyPage ? (
        <button
          type="button"
          onClick={noResults ? onClear : () => onPageChange(1)}
          className="mt-5 rounded-xl border border-[#cbd5e1] px-4 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
        >
          {noResults ? 'Hapus pencarian' : 'Kembali ke halaman pertama'}
        </button>
      ) : null}
      <span className="sr-only">Total anggota: {total}</span>
    </section>
  )
}

function MemberDegraded() {
  return (
    <section
      role="status"
      aria-live="polite"
      data-members-degraded="true"
      className="mb-4 rounded-2xl border border-[#f59e0b]/40 bg-[#fffbeb] px-5 py-4"
    >
      <h2 className="text-sm font-semibold text-[#92400e]">
        Sebagian snapshot data belum tersedia
      </h2>
      <p className="mt-1 text-xs leading-[19px] text-[#92400e]">
        Identitas anggota tetap dapat digunakan. Status snapshot ditandai pada
        setiap anggota.
      </p>
    </section>
  )
}

export function MemberError({
  error,
  onRetry,
}: {
  error: Error
  onRetry: () => void
}) {
  const forbidden = error instanceof MemberApiError && error.status === 403
  return (
    <section
      role="alert"
      aria-live="assertive"
      data-members-error={forbidden ? 'forbidden' : 'request'}
      className="rounded-2xl border border-[#e2e8f0] bg-white p-6 sm:p-7"
    >
      <h2 className="text-xl font-semibold">
        {forbidden
          ? 'Akses anggota ditolak'
          : 'Direktori anggota tidak dapat dimuat'}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#64748b]">
        {forbidden
          ? 'Akun ini tidak memiliki izin untuk melihat direktori anggota.'
          : 'Data anggota sedang tidak tersedia. Coba lagi tanpa keluar dari sesi Anda.'}
      </p>
      {!forbidden ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-xl bg-[#2563eb] px-4 py-2 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
        >
          Coba lagi
        </button>
      ) : null}
    </section>
  )
}

export function MemberForbidden() {
  return (
    <section
      role="alert"
      data-members-forbidden="true"
      className="mx-auto max-w-[1120px] rounded-2xl border border-[#e2e8f0] bg-white p-6 sm:p-7"
    >
      <h2 className="text-xl font-semibold">Akses anggota ditolak</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#64748b]">
        Akun ini tidak memiliki izin untuk melihat direktori anggota.
      </p>
    </section>
  )
}
