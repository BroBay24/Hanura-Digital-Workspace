import { useEffect } from 'react'
import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { AccountMenu } from '#/integrations/better-auth/account-menu'
import {
  AppShell,
  ShellErrorState,
  ShellLoadingState,
} from '#/components/app-shell'
import { getCurrentPrincipal } from '#/lib/session.functions'
import type { AuthSession } from '#/lib/session-client'
import { authSessionQueryKey, useAuthSession } from '#/lib/session-client'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    const { hadSessionCookie, principal } = await getCurrentPrincipal()
    if (!principal) {
      context.queryClient.setQueryData(authSessionQueryKey, {
        data: {
          authenticated: false,
          user: null,
          session: null,
          authorization: null,
        },
      } satisfies AuthSession)
      throw redirect({
        to: '/login',
        search: hadSessionCookie ? { reason: 'session-expired' } : {},
      })
    }
    const session = {
      data: {
        authenticated: true,
        user: principal.user,
        session: principal.session,
        authorization: {
          roles: principal.authorization.roles,
          permissions: principal.authorization.permissions,
        },
      },
    } satisfies AuthSession
    context.queryClient.setQueryData(authSessionQueryKey, session)
  },
  pendingComponent: ShellLoadingState,
  errorComponent: ProtectedShellError,
  component: ProtectedLayout,
})

function ProtectedShellError() {
  const router = useRouter()
  return <ShellErrorState onRetry={() => void router.invalidate()} />
}

function ProtectedLayout() {
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()

  useEffect(() => {
    if (sessionQuery.data?.data.authenticated) return
    if (sessionQuery.data && !sessionQuery.data.data.authenticated) {
      void navigate({
        to: '/login',
        search: { reason: 'session-expired' },
        replace: true,
      })
    }
  }, [navigate, sessionQuery.data])

  if (sessionQuery.isPending) return <ShellLoadingState />

  if (sessionQuery.isError) {
    return <ShellErrorState onRetry={() => void sessionQuery.refetch()} />
  }

  if (!sessionQuery.data.data.authenticated) return null

  return (
    <AppShell account={<AccountMenu session={sessionQuery.data.data} />}>
      <Outlet />
    </AppShell>
  )
}
