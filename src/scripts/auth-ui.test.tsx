import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AppHeader,
  DEFAULT_APP_HEADER_CONTEXT,
  resolveAppHeaderContext,
} from '#/components/app-header'
import {
  AppShell,
  ShellErrorState,
  ShellLoadingState,
} from '#/components/app-shell'
import {
  roleDisplayLabel,
  runLogoutWorkflow,
} from '#/integrations/better-auth/account-menu'
import {
  AuthPageLayout,
  LoginView,
  SessionExpiredView,
} from '#/integrations/better-auth/login-view'
import {
  AuthApiError,
  fetchAuthSession,
  hasPermission,
  loginReasonForLostSession,
  loginWithPassword,
  logoutCurrentSession,
} from '#/lib/session-client'
import { validateLoginInput } from '#/routes/login'

const authenticatedSession = {
  data: {
    authenticated: true as const,
    user: {
      id: 'demo-user-manager',
      email: 'manager.demo@hanura.local',
      name: 'Demo Manager',
    },
    session: { expiresAt: '2026-10-01T00:00:00.000Z' },
    authorization: {
      roles: ['MANAGER'],
      permissions: ['approval.manager.decide', 'member.read', 'report.read'],
    },
  },
}

test('shared header resolves the deepest page context with a safe fallback', () => {
  assert.deepEqual(resolveAppHeaderContext([]), DEFAULT_APP_HEADER_CONTEXT)
  assert.deepEqual(
    resolveAppHeaderContext([
      { title: 'Parent', subtitle: 'Parent context' },
      undefined,
      { title: 'Child', subtitle: 'Child context' },
    ]),
    { title: 'Child', subtitle: 'Child context' },
  )

  const markup = renderToStaticMarkup(
    <AppHeader
      account={<button type="button">Account</button>}
      context={{ title: 'Dasbor', subtitle: 'Ruang Kerja Digital Hanura' }}
      navigation={<button type="button">Menu</button>}
    />,
  )
  assert.match(markup, /data-app-header="true"/)
  assert.match(markup, /h-\[72px\]/)
  assert.match(markup, /<h1[^>]*>Dasbor<\/h1>/)
  assert.match(markup, /Ruang Kerja Digital Hanura/)
  assert.match(markup, />Menu</)
  assert.match(markup, />Account</)
})

test('account presentation uses safe human-readable role labels', () => {
  assert.equal(roleDisplayLabel('CHAIRMAN'), 'Ketua / Pengurus')
  assert.equal(roleDisplayLabel('MANAGER'), 'Manajer')
  assert.equal(roleDisplayLabel('CREDIT_OFFICER'), 'Petugas Kredit')
  assert.equal(roleDisplayLabel('TELLER'), 'Teller / Staf')
  assert.equal(roleDisplayLabel('ADMIN'), 'Administrator')
  assert.equal(roleDisplayLabel('UNKNOWN_ROLE'), 'Pengguna')
  assert.equal(roleDisplayLabel(), 'Pengguna')
})

test('application shell exposes one accessible structural layout', () => {
  const markup = renderToStaticMarkup(
    <AppShell account={<button type="button">Account</button>}>
      <section>Child route content</section>
    </AppShell>,
  )

  assert.equal((markup.match(/data-app-shell="true"/g) ?? []).length, 1)
  assert.match(markup, /grid-cols-\[240px_minmax\(0,1fr\)\]/)
  assert.match(markup, /data-app-header="true"/)
  assert.match(markup, /h-\[72px\]/)
  assert.match(markup, /<h1[^>]*>Ruang Kerja Digital<\/h1>/)
  assert.match(markup, /<aside/)
  assert.doesNotMatch(markup, /<nav aria-label="Navigasi utama"/)
  assert.doesNotMatch(markup, /data-shell-navigation-slot="true"/)
  assert.match(markup, /data-shell-header-slot="true"/)
  assert.match(markup, /data-shell-account-slot="true"/)
  assert.match(markup, /href="#main-content"/)
  assert.match(markup, /style="color:#ffffff"/)
  assert.match(markup, /<main id="main-content"/)
  assert.match(markup, /Child route content/)
  assert.doesNotMatch(markup, /approval\.|admin\.user_access|loan\.create/)
})

test('shell loading and failure states do not render protected content', () => {
  const loading = renderToStaticMarkup(<ShellLoadingState />)
  assert.match(loading, /data-app-header="true"/)
  assert.equal((loading.match(/<h1/g) ?? []).length, 1)
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /Memuat ruang kerja…/)
  assert.doesNotMatch(loading, /Sesi aktif|Ruang kerja siap digunakan/)

  const failure = renderToStaticMarkup(
    <ShellErrorState onRetry={() => undefined} />,
  )
  assert.match(failure, /data-app-header="true"/)
  assert.equal((failure.match(/<h1/g) ?? []).length, 1)
  assert.match(failure, /<h2[^>]*>Ruang kerja tidak dapat dimuat<\/h2>/)
  assert.match(failure, /role="alert"/)
  assert.match(failure, /aria-live="assertive"/)
  assert.match(failure, /Ruang kerja tidak dapat dimuat/)
  assert.match(failure, /Sesi tidak dapat diverifikasi/)
  assert.match(failure, /Coba lagi/)
  assert.doesNotMatch(failure, /Sesi aktif|Ruang kerja siap digunakan/)
})

test('login input validation is deterministic and does not mutate password', () => {
  assert.deepEqual(validateLoginInput({ email: '', password: '' }), {
    data: { email: '', password: '' },
    errors: {
      email: 'Email wajib diisi.',
      password: 'Password wajib diisi.',
    },
  })
  assert.deepEqual(
    validateLoginInput({ email: 'invalid', password: ' secret ' }),
    {
      data: { email: 'invalid', password: ' secret ' },
      errors: { email: 'Email tidak valid.' },
    },
  )
  assert.deepEqual(
    validateLoginInput({
      email: '  manager.demo@hanura.local  ',
      password: ' secret ',
    }),
    {
      data: {
        email: 'manager.demo@hanura.local',
        password: ' secret ',
      },
      errors: {},
    },
  )
})

test('login view renders Figma copy and accessible form states', () => {
  const markup = renderToStaticMarkup(
    <LoginView
      email=""
      password=""
      fieldErrors={{
        email: 'Email wajib diisi.',
        password: 'Password wajib diisi.',
      }}
      formError="Email atau kata sandi tidak valid."
      isSubmitting={false}
      onEmailChange={() => undefined}
      onPasswordChange={() => undefined}
      onSubmit={() => undefined}
    />,
  )

  assert.match(markup, /HANURA/)
  assert.match(markup, /Ruang Kerja Digital/)
  assert.match(markup, /Email \/ Penggunaname/)
  assert.match(markup, /Demo environment · Sintetis data hanya/)
  assert.match(markup, /type="email"/)
  assert.match(markup, /autoComplete="username"/)
  assert.match(markup, /type="password"/)
  assert.match(markup, /autoComplete="current-password"/)
  assert.match(markup, /aria-invalid="true"/)
  assert.match(markup, /aria-describedby="email-error"/)
  assert.match(markup, /role="alert"/)
  assert.doesNotMatch(markup, /localStorage|sessionStorage/)
})

test('login view exposes an accessible loading state', () => {
  const markup = renderToStaticMarkup(
    <LoginView
      email="manager.demo@hanura.local"
      password="not-persisted"
      fieldErrors={{}}
      isSubmitting
      onEmailChange={() => undefined}
      onPasswordChange={() => undefined}
      onSubmit={() => undefined}
    />,
  )

  assert.match(markup, /Masuk…/)
  assert.match(markup, /aria-busy="true"/)
  assert.match(markup, /disabled=""/)
})

test('session expired view follows the dedicated Figma state', () => {
  const markup = renderToStaticMarkup(
    <SessionExpiredView onLoginAgain={() => undefined} />,
  )
  assert.match(markup, /Session Expired/)
  assert.match(markup, /AUTH/)
  assert.match(markup, /Your session adalah no longer valid/)
  assert.match(markup, /Masuk again →/)
})

test('auth page remains a semantic responsive shell', () => {
  const markup = renderToStaticMarkup(
    <AuthPageLayout>
      <section>Form</section>
    </AuthPageLayout>,
  )
  assert.match(markup, /<main/)
  assert.match(markup, /max-w-\[1180px\]/)
  assert.match(markup, /lg:grid-cols-\[430px_460px\]/)
})

test('session API client models loading targets without persistent auth storage', async () => {
  const fetcher = async () =>
    Response.json(authenticatedSession, { status: 200 })
  const session = await fetchAuthSession(fetcher)
  assert.deepEqual(session, authenticatedSession)
  assert.equal(hasPermission(session, 'approval.manager.decide'), true)
  assert.equal(hasPermission(session, 'approval.chairman.decide'), false)
  assert.equal(loginReasonForLostSession(false), undefined)
  assert.equal(loginReasonForLostSession(true), 'session-expired')
})

test('login and logout client helpers use cookie-backed endpoints only', async () => {
  const requests: Array<Request> = []
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? new URL(input, 'http://localhost') : input
    requests.push(new Request(url, init))
    return Response.json({
      data: {
        authenticated: requests.length === 1,
        user:
          requests.length === 1 ? authenticatedSession.data.user : undefined,
      },
    })
  }

  await loginWithPassword(
    { email: 'manager.demo@hanura.local', password: 'not-persisted' },
    fetcher,
  )
  await logoutCurrentSession(fetcher)

  assert.equal(requests[0].url.endsWith('/api/v1/auth/login'), true)
  assert.equal(requests[1].url.endsWith('/api/v1/auth/logout'), true)
  assert.equal(requests[0].credentials, 'include')
  assert.equal(requests[1].credentials, 'include')
  assert.doesNotMatch(await requests[1].text(), /password|token/i)
})

test('successful logout does not depend on parsing the response body', async () => {
  const result = await logoutCurrentSession(
    async () => new Response('malformed-but-successful', { status: 200 }),
  )
  assert.deepEqual(result, { data: { authenticated: false } })
})

test('logout workflow clears session and navigates only after success', async () => {
  const actions: Array<string> = []
  await runLogoutWorkflow({
    logout: async () => actions.push('logout'),
    clearSession: () => actions.push('clear'),
    navigateToLogin: async () => actions.push('navigate'),
  })
  assert.deepEqual(actions, ['logout', 'clear', 'navigate'])

  actions.length = 0
  await assert.rejects(
    runLogoutWorkflow({
      logout: async () => {
        actions.push('logout')
        throw new Error('network failure')
      },
      clearSession: () => actions.push('clear'),
      navigateToLogin: async () => actions.push('navigate'),
    }),
    /network failure/,
  )
  assert.deepEqual(actions, ['logout'])
})

test('session API failures produce safe typed errors', async () => {
  await assert.rejects(
    fetchAuthSession(async () =>
      Response.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Layanan sedang bermasalah.',
            correlationId: 'safe-reference',
          },
        },
        { status: 500 },
      ),
    ),
    (error: unknown) =>
      error instanceof AuthApiError &&
      error.code === 'INTERNAL_ERROR' &&
      error.correlationId === 'safe-reference',
  )
})
