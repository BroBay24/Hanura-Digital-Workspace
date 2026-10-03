import type {
  DashboardReadModel,
  DashboardSection as DashboardSectionModel,
  DashboardSectionId,
} from '#/lib/dashboard-contract'
import { useDashboard } from '#/lib/dashboard-client'

const sectionCopy: Record<
  DashboardSectionId,
  { eyebrow: string; title: string; description: string }
> = {
  'member-overview': {
    eyebrow: 'Anggota',
    title: 'Ringkasan cache anggota',
    description: 'Status referensi anggota yang tersimpan di ruang kerja.',
  },
  'member-snapshot-health': {
    eyebrow: 'Snapshot anggota',
    title: 'Kesehatan data snapshot',
    description: 'Ketersediaan cache snapshot; bukan catatan finansial resmi.',
  },
  'loan-workflow': {
    eyebrow: 'Pengajuan pinjaman',
    title: 'Distribusi alur kerja',
    description: 'Jumlah pengajuan pada setiap tahap operasional Workspace.',
  },
  'document-workload': {
    eyebrow: 'Dokumen',
    title: 'Beban kerja dokumen',
    description: 'Jumlah dokumen menurut status proses verifikasi.',
  },
  'credit-review-workload': {
    eyebrow: 'Tinjauan kredit',
    title: 'Beban kerja tinjauan',
    description: 'Jumlah tinjauan kredit yang selesai dan masih menunggu.',
  },
  'manager-approval-queue': {
    eyebrow: 'Persetujuan manajer',
    title: 'Antrean keputusan manajer',
    description: 'Keputusan Workspace yang memerlukan izin manajer.',
  },
  'chairman-approval-queue': {
    eyebrow: 'Persetujuan ketua',
    title: 'Antrean keputusan ketua',
    description: 'Keputusan Workspace yang memerlukan izin ketua.',
  },
  'operational-report': {
    eyebrow: 'Laporan operasional',
    title: 'Ringkasan alur kerja',
    description: 'Ringkasan yang diturunkan dari status proses Workspace.',
  },
  'access-summary': {
    eyebrow: 'Pengguna & akses',
    title: 'Ringkasan akses ruang kerja',
    description: 'Jumlah akun, penugasan peran, dan pemetaan izin.',
  },
  'audit-summary': {
    eyebrow: 'Aktivitas',
    title: 'Ringkasan audit',
    description: 'Jumlah peristiwa audit dan hasil pencatatannya.',
  },
  'integration-status': {
    eyebrow: 'Integrasi',
    title: 'Status pekerjaan integrasi',
    description: 'Status proses integrasi yang dicatat oleh Workspace.',
  },
  'settings-summary': {
    eyebrow: 'Pengaturan',
    title: 'Konfigurasi ruang kerja',
    description: 'Jumlah pengaturan Workspace yang telah tersimpan.',
  },
}

const metricLabels: Record<string, string> = {
  total: 'Total',
  'cached-active': 'Status aktif tersimpan',
  'cached-inactive': 'Status tidak aktif tersimpan',
  'cached-unknown': 'Status belum diketahui',
  fresh: 'Snapshot segar',
  stale: 'Snapshot usang',
  draft: 'Draf',
  submitted: 'Diajukan',
  document_verification: 'Verifikasi dokumen',
  credit_review: 'Tinjauan kredit',
  manager_approval: 'Persetujuan manajer',
  chairman_approval: 'Persetujuan ketua',
  approved: 'Disetujui',
  ready_for_core_integration: 'Siap untuk integrasi inti',
  returned_for_revision: 'Dikembalikan untuk revisi',
  rejected: 'Ditolak',
  required: 'Wajib dilengkapi',
  uploaded: 'Diunggah',
  verified: 'Terverifikasi',
  reupload_required: 'Perlu unggah ulang',
  pending: 'Menunggu',
  completed: 'Selesai',
  returned: 'Dikembalikan',
  'completed-workflow': 'Alur kerja selesai',
  exceptions: 'Dikembalikan atau ditolak',
  applications: 'Pengajuan',
  users: 'Pengguna Workspace',
  'role-assignments': 'Penugasan peran',
  'permission-mappings': 'Pemetaan izin',
  events: 'Peristiwa audit',
  successful: 'Hasil berhasil',
  other: 'Hasil lainnya',
  running: 'Berjalan',
  succeeded: 'Berhasil',
  failed: 'Gagal',
  'retryable-failed': 'Gagal, dapat dicoba ulang',
  configured: 'Pengaturan tersimpan',
}

const sourceLabels: Record<DashboardSectionModel['source']['kind'], string> = {
  workspace: 'Data Workspace',
  'workspace-derived': 'Ringkasan turunan Workspace',
  'mock-cache': 'Data simulasi · cache',
  'provider-cache': 'Data penyedia · cache',
  'mock-snapshot': 'Data simulasi · snapshot',
  'provider-snapshot': 'Data penyedia · snapshot',
}

export function DashboardPage() {
  const dashboardQuery = useDashboard()

  if (dashboardQuery.isPending) return <DashboardLoading />
  if (dashboardQuery.isError) {
    return <DashboardError onRetry={() => void dashboardQuery.refetch()} />
  }
  return <DashboardContent model={dashboardQuery.data.data} />
}

export function DashboardContent({ model }: { model: DashboardReadModel }) {
  return (
    <div data-dashboard-page="true" className="mx-auto max-w-[1120px]">
      {model.context.degraded ? (
        <DegradedNotice sources={model.context.degradedSources} />
      ) : null}

      {model.sections.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {model.sections.map((section) => (
            <DashboardSection key={section.id} section={section} />
          ))}
        </div>
      ) : (
        <section
          data-dashboard-empty="true"
          className="rounded-2xl border border-[#e2e8f0] bg-white p-6 sm:p-7"
          aria-labelledby="dashboard-empty-title"
        >
          <h2 id="dashboard-empty-title" className="text-xl font-semibold">
            Belum ada ringkasan yang tersedia
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#64748b]">
            Dashboard hanya menampilkan informasi yang diizinkan oleh server.
          </p>
        </section>
      )}
    </div>
  )
}

export function DashboardSection({
  section,
}: {
  section: DashboardSectionModel
}) {
  const copy = sectionCopy[section.id]
  const titleId = `dashboard-section-${section.id}`

  return (
    <section
      aria-labelledby={titleId}
      data-dashboard-section={section.id}
      data-section-state={section.state}
      className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] leading-[15px] font-semibold tracking-[0.14em] text-[#2563eb] uppercase">
            {copy.eyebrow}
          </p>
          <h2
            id={titleId}
            className="mt-2 text-lg leading-[26px] font-semibold"
          >
            {copy.title}
          </h2>
        </div>
        <SourceBadge source={section.source} />
      </div>
      <p className="mt-2 max-w-2xl text-xs leading-[19px] text-[#64748b]">
        {copy.description}
      </p>

      {section.state === 'unavailable' ? (
        <UnavailableSection />
      ) : section.state === 'empty' ? (
        <EmptySection metrics={section.metrics} />
      ) : (
        <MetricGrid metrics={section.metrics} />
      )}
    </section>
  )
}

function MetricGrid({
  metrics,
}: {
  metrics: DashboardSectionModel['metrics']
}) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {metrics.map((metric) => (
        <MetricCard key={metric.key} metric={metric} />
      ))}
    </dl>
  )
}

function MetricCard({
  metric,
}: {
  metric: DashboardSectionModel['metrics'][number]
}) {
  const label = metricLabels[metric.key] ?? metric.label
  return (
    <div
      data-dashboard-metric={metric.key}
      className="min-w-0 rounded-xl bg-[#f8fafc] px-4 py-3"
    >
      <dt className="text-[11px] leading-4 text-[#64748b]">{label}</dt>
      <dd className="mt-1 text-2xl leading-8 font-semibold tabular-nums text-[#0f172a]">
        {metric.value.toLocaleString('id-ID')}
      </dd>
    </div>
  )
}

function EmptySection({
  metrics,
}: {
  metrics: DashboardSectionModel['metrics']
}) {
  return (
    <div
      data-dashboard-state="empty"
      className="mt-5 rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-4"
    >
      <p className="text-sm font-medium">Belum ada data pada ringkasan ini.</p>
      <p className="mt-1 text-xs leading-[19px] text-[#64748b]">
        Sumber tersedia dan saat ini mencatat nilai nol.
      </p>
      <MetricGrid metrics={metrics} />
    </div>
  )
}

function UnavailableSection() {
  return (
    <div
      role="status"
      data-dashboard-state="unavailable"
      className="mt-5 rounded-xl border border-[#f59e0b]/40 bg-[#fffbeb] p-4"
    >
      <p className="text-sm font-semibold text-[#92400e]">
        Sumber data sementara tidak tersedia
      </p>
      <p className="mt-1 text-xs leading-[19px] text-[#92400e]">
        Nilai tidak ditampilkan karena kondisi ini berbeda dari nol.
      </p>
    </div>
  )
}

function SourceBadge({ source }: { source: DashboardSectionModel['source'] }) {
  const materialProvenance =
    source.kind.includes('cache') ||
    source.kind.includes('snapshot') ||
    source.provider === 'mock'
  if (!materialProvenance) return null
  const label =
    source.provider === 'mock' && source.kind === 'workspace-derived'
      ? 'Data simulasi · ringkasan'
      : sourceLabels[source.kind]
  return (
    <span className="shrink-0 rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 py-1 text-[10px] leading-[15px] font-medium text-[#475569]">
      {label}
    </span>
  )
}

function DegradedNotice({
  sources,
}: {
  sources: DashboardReadModel['context']['degradedSources']
}) {
  return (
    <section
      role="status"
      aria-live="polite"
      data-dashboard-degraded="true"
      className="mb-4 rounded-2xl border border-[#f59e0b]/40 bg-[#fffbeb] px-5 py-4"
    >
      <h2 className="text-sm font-semibold text-[#92400e]">
        Sebagian data belum tersedia
      </h2>
      <p className="mt-1 text-xs leading-[19px] text-[#92400e]">
        Ringkasan Workspace tetap dapat digunakan. Bagian yang terdampak
        ditandai secara terpisah ({sources.length} sumber).
      </p>
    </section>
  )
}

export function DashboardLoading() {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      data-dashboard-loading="true"
      className="mx-auto max-w-[1120px]"
    >
      <h2 className="sr-only">Memuat dashboard</h2>
      <p role="status" className="sr-only">
        Memuat ringkasan dashboard…
      </p>
      <div aria-hidden="true" className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="min-h-44 animate-pulse rounded-2xl border border-[#e2e8f0] bg-white p-6"
          >
            <div className="h-3 w-24 rounded-full bg-[#e2e8f0]" />
            <div className="mt-4 h-6 w-48 max-w-full rounded-full bg-[#e2e8f0]" />
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="h-16 rounded-xl bg-[#f1f5f9]" />
              <div className="h-16 rounded-xl bg-[#f1f5f9]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      aria-live="assertive"
      data-dashboard-error="true"
      className="mx-auto max-w-[1120px] rounded-2xl border border-[#e2e8f0] bg-white p-6 sm:p-7"
    >
      <h2 className="text-xl font-semibold">Dashboard tidak dapat dimuat</h2>
      <p className="mt-2 text-sm leading-6 text-[#64748b]">
        Ringkasan operasional sedang tidak tersedia. Coba lagi tanpa keluar dari
        sesi Anda.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
      >
        Coba lagi
      </button>
    </section>
  )
}
