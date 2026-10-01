import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/')({
  head: () => ({
    meta: [{ title: 'Hanura Digital Workspace' }],
  }),
  component: WorkspaceEntry,
})

function WorkspaceEntry() {
  return (
    <section className="max-w-[1120px] rounded-2xl border border-[#e2e8f0] bg-white p-6 sm:p-7">
      <p className="text-[11px] font-medium tracking-wide text-[#2563eb] uppercase">
        Sesi aktif
      </p>
      <h1 className="mt-3 text-[28px] leading-[41px] font-semibold">
        Ruang kerja siap digunakan
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#64748b]">
        Fondasi application shell dan authorization context tersedia. Navigasi
        berbasis akses serta konten dashboard akan dibangun pada tahap
        berikutnya.
      </p>
    </section>
  )
}
