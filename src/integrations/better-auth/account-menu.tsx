import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthenticatedSession } from '#/lib/session-client'
import { authSessionQueryKey, logoutCurrentSession } from '#/lib/session-client'

export const runLogoutWorkflow = async ({
  logout,
  clearSession,
  navigateToLogin,
}: {
  logout: () => Promise<unknown>
  clearSession: () => void
  navigateToLogin: () => Promise<unknown>
}) => {
  await logout()
  clearSession()
  await navigateToLogin()
}

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrator',
  CHAIRMAN: 'Ketua / Pengurus',
  CREDIT_OFFICER: 'Petugas Kredit',
  MANAGER: 'Manajer',
  TELLER: 'Teller / Staf',
}

export function AccountMenu({
  session,
}: {
  session: AuthenticatedSession['data']
}) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string>()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const primaryRoleCode = session.authorization.roles[0]
  const primaryRole = primaryRoleCode
    ? (roleLabels[primaryRoleCode] ?? primaryRoleCode)
    : 'Pengguna'

  const logout = async () => {
    if (isLoggingOut) return
    setLogoutError(undefined)
    setIsLoggingOut(true)
    try {
      await runLogoutWorkflow({
        logout: () => logoutCurrentSession(),
        clearSession: () =>
          queryClient.removeQueries({ queryKey: authSessionQueryKey }),
        navigateToLogin: () => navigate({ to: '/login', replace: true }),
      })
      setIsLoggingOut(false)
    } catch {
      setLogoutError('Tidak dapat keluar. Silakan coba lagi.')
      setIsLoggingOut(false)
    }
  }

  return (
    <details className="account-menu relative">
      <summary className="account-trigger flex cursor-pointer list-none items-center gap-2 rounded-full border border-[#2563eb] bg-white px-3 py-2 text-[11px] leading-4 font-medium text-[#0f172a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]">
        <span
          aria-hidden="true"
          className="flex h-4 w-4 items-center justify-center rounded-full bg-[#2563eb] text-[9px] font-semibold text-white"
        >
          {session.user.name.charAt(0).toUpperCase()}
        </span>
        <span>{primaryRole}</span>
      </summary>

      <div className="absolute top-[calc(100%+8px)] right-0 z-20 w-72 rounded-2xl border border-[#e2e8f0] bg-white p-4 text-[#0f172a] shadow-lg">
        <p className="truncate text-sm font-semibold">{session.user.name}</p>
        <p className="mt-1 truncate text-xs text-[#64748b]">
          {session.user.email}
        </p>
        <p className="mt-3 text-[11px] font-medium tracking-wide text-[#2563eb] uppercase">
          {session.authorization.roles
            .map((role) => roleLabels[role] ?? role)
            .join(' · ') || 'Tanpa peran'}
        </p>
        {logoutError ? (
          <p role="alert" className="mt-3 text-xs text-red-700">
            {logoutError}
          </p>
        ) : null}
        <button
          type="button"
          disabled={isLoggingOut}
          onClick={() => void logout()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-[#e2e8f0] px-4 py-2 text-xs font-medium hover:bg-[#f8fafc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] disabled:cursor-wait disabled:opacity-60"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          {isLoggingOut ? 'Keluar…' : 'Keluar'}
        </button>
      </div>
    </details>
  )
}
