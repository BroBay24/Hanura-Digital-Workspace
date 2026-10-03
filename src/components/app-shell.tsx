import type { ReactNode } from 'react'
import type { AppHeaderContext } from './app-header.tsx'
import { AppHeader, DEFAULT_APP_HEADER_CONTEXT } from './app-header.tsx'
import { AppNavigation, NarrowNavigation } from './app-navigation.tsx'

const ShellBrand = () => (
  <div className="min-w-0">
    <p className="text-xl leading-[29px] font-semibold text-white">HANURA</p>
    <p className="mt-3 text-[11px] leading-4 text-white/80">
      Ruang Kerja Digital
    </p>
    <p className="mt-2 text-[10px] leading-[15px] font-medium tracking-[0.16em] text-white/55 uppercase">
      Workspace
    </p>
  </div>
)

export function AppShell({
  account,
  children,
  headerContext = DEFAULT_APP_HEADER_CONTEXT,
  permissions,
}: {
  account: ReactNode
  children: ReactNode
  headerContext?: AppHeaderContext
  permissions?: readonly string[]
}) {
  return (
    <div
      data-app-shell="true"
      className="min-h-screen bg-[#f8fafc] font-[var(--font-auth)] text-[#0f172a] lg:grid lg:grid-cols-[240px_minmax(0,1fr)]"
    >
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-medium focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-white"
        style={{ color: '#ffffff' }}
      >
        Lewati ke konten utama
      </a>

      <aside className="hidden bg-[#0f172a] px-5 py-7 lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <ShellBrand />
        {permissions ? (
          <div className="mt-7" data-shell-navigation-slot="true">
            <AppNavigation label="Navigasi utama" permissions={permissions} />
          </div>
        ) : null}
      </aside>

      <div className="min-w-0">
        <AppHeader
          account={account}
          context={headerContext}
          navigation={
            permissions ? (
              <NarrowNavigation permissions={permissions} />
            ) : undefined
          }
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 px-5 py-8 outline-none sm:px-7 lg:py-6"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

const SafeShellAccountPlaceholder = () => (
  <div
    aria-hidden="true"
    className="h-[34px] w-24 rounded-full border border-[#e2e8f0] bg-[#f8fafc]"
  />
)

export function ShellLoadingState({
  headerContext,
}: {
  headerContext?: AppHeaderContext
}) {
  return (
    <AppShell
      account={<SafeShellAccountPlaceholder />}
      headerContext={headerContext}
    >
      <section
        aria-busy="true"
        aria-live="polite"
        className="rounded-2xl border border-[#e2e8f0] bg-white p-6"
      >
        <div
          role="status"
          className="flex items-center gap-3 text-sm text-[#64748b]"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-pulse rounded-full bg-[#2563eb]/25"
          />
          Memuat ruang kerja…
        </div>
      </section>
    </AppShell>
  )
}

export function ShellErrorState({
  headerContext,
  onRetry,
}: {
  headerContext?: AppHeaderContext
  onRetry: () => void
}) {
  return (
    <AppShell
      account={<SafeShellAccountPlaceholder />}
      headerContext={headerContext}
    >
      <section
        role="alert"
        aria-live="assertive"
        className="max-w-xl rounded-2xl border border-[#e2e8f0] bg-white p-6"
      >
        <h2 className="text-xl font-semibold">
          Ruang kerja tidak dapat dimuat
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#64748b]">
          Sesi tidak dapat diverifikasi. Periksa jaringan dan coba lagi.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
        >
          Coba lagi
        </button>
      </section>
    </AppShell>
  )
}
