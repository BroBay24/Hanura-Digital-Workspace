import { useEffect, useRef } from 'react'
import { LoaderCircle } from 'lucide-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AccountMenu } from '#/integrations/better-auth/account-menu'
import { loginReasonForLostSession, useAuthSession } from '#/lib/session-client'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [{ title: 'Hanura Digital Workspace' }],
  }),
  component: AuthenticatedLanding,
})

function AuthenticatedLanding() {
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()
  const wasAuthenticated = useRef(false)

  useEffect(() => {
    if (sessionQuery.data?.data.authenticated) {
      wasAuthenticated.current = true
      return
    }

    if (sessionQuery.data && !sessionQuery.data.data.authenticated) {
      const reason = loginReasonForLostSession(wasAuthenticated.current)
      void navigate({
        to: '/login',
        search: reason ? { reason } : {},
        replace: true,
      })
    }
  }, [navigate, sessionQuery.data])

  if (sessionQuery.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-6 font-sans text-[#0f172a]">
        <section className="w-full max-w-lg rounded-2xl border border-[#e2e8f0] bg-white p-8">
          <h1 className="text-xl font-semibold">
            Ruang kerja tidak dapat dimuat
          </h1>
          <p className="mt-2 text-sm text-[#64748b]">
            Periksa jaringan dan coba lagi.
          </p>
          <button
            type="button"
            onClick={() => void sessionQuery.refetch()}
            className="mt-5 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
          >
            Coba lagi
          </button>
        </section>
      </main>
    )
  }

  if (sessionQuery.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] font-sans text-[#64748b]">
        <div role="status" className="flex items-center gap-3 text-sm">
          <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
          Memuat ruang kerja…
        </div>
      </main>
    )
  }

  if (!sessionQuery.data.data.authenticated) return null

  return (
    <main className="min-h-screen bg-[#f8fafc] font-sans text-[#0f172a]">
      <header className="flex h-[72px] items-center justify-between border-b border-[#e2e8f0] bg-white px-6 lg:px-7">
        <div>
          <p className="text-xl leading-[29px] font-semibold">HANURA</p>
          <p className="text-[11px] leading-4 text-[#64748b]">
            Ruang Kerja Digital Hanura
          </p>
        </div>
        <AccountMenu session={sessionQuery.data.data} />
      </header>

      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="text-[11px] font-medium tracking-wide text-[#2563eb] uppercase">
          Sesi aktif
        </p>
        <h1 className="mt-3 text-[28px] leading-[41px] font-semibold">
          Ruang kerja siap digunakan
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#64748b]">
          Authentication dan authorization context tersedia. Application Shell
          dan dashboard akan dibangun pada milestone berikutnya.
        </p>
      </section>
    </main>
  )
}
