import { LoaderCircle } from 'lucide-react'
import type { FormEventHandler } from 'react'

export type LoginFieldErrors = Partial<Record<'email' | 'password', string>>

export type LoginViewProps = {
  email: string
  password: string
  fieldErrors: LoginFieldErrors
  formError?: string
  isSubmitting: boolean
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
}

export function AuthPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="login-page min-h-screen bg-[#f8fafc] font-sans text-[#0f172a]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1180px] grid-cols-1 items-center gap-12 px-6 py-12 lg:grid-cols-[430px_460px] lg:items-start lg:gap-[260px] lg:px-0 lg:pt-[180px] lg:pb-0">
        <section
          aria-labelledby="brand-title"
          className="w-full max-w-[430px] bg-white lg:mt-10 lg:h-[300px]"
        >
          <div className="flex flex-col gap-4">
            <p className="text-[18px] leading-[26px] font-semibold text-[#2563eb]">
              HANURA
            </p>
            <h1
              id="brand-title"
              className="text-[44px] leading-[64px] font-semibold tracking-[-0.02em]"
            >
              Ruang Kerja Digital
            </h1>
            <p className="max-w-[420px] text-base leading-[23px] text-[#64748b]">
              satu workspace untuk cooperative operasi, approvals, member
              konteks, dan integration-aware workflows.
            </p>
          </div>
        </section>
        {children}
      </div>
    </main>
  )
}

export function LoginView({
  email,
  password,
  fieldErrors,
  formError,
  isSubmitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginViewProps) {
  return (
    <AuthPageLayout>
      <section
        aria-labelledby="login-title"
        className="w-full max-w-[460px] rounded-2xl border border-[#e2e8f0] bg-white p-9 lg:min-h-[520px]"
      >
        <h2
          id="login-title"
          className="text-[28px] leading-[41px] font-semibold"
        >
          Masuk
        </h2>
        <p className="mt-3 text-[13px] leading-[19px] text-[#64748b]">
          gunakan your Hanura internal account.
        </p>

        <form
          className="mt-3 flex flex-col gap-3"
          noValidate
          onSubmit={onSubmit}
        >
          <label
            className="flex min-h-[84px] flex-col gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4 focus-within:border-[#2563eb] focus-within:ring-2 focus-within:ring-[#2563eb]/15"
            htmlFor="email"
          >
            <span
              aria-hidden="true"
              className="text-[11px] leading-4 font-medium text-[#64748b]"
            >
              Email / Penggunaname
            </span>
            <span className="sr-only">Email / Pengguna</span>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              disabled={isSubmitting}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              placeholder="user@hanura.local"
              onChange={(event) => onEmailChange(event.target.value)}
              className="min-w-0 border-0 bg-transparent p-0 text-sm leading-5 font-medium outline-none placeholder:text-[#0f172a] disabled:opacity-60"
            />
          </label>
          {fieldErrors.email ? (
            <p id="email-error" className="text-xs text-red-700">
              {fieldErrors.email}
            </p>
          ) : null}

          <label
            className="flex min-h-[84px] flex-col gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4 focus-within:border-[#2563eb] focus-within:ring-2 focus-within:ring-[#2563eb]/15"
            htmlFor="password"
          >
            <span className="text-[11px] leading-4 font-medium text-[#64748b]">
              Password
            </span>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={isSubmitting}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? 'password-error' : undefined
              }
              placeholder="••••••••••"
              onChange={(event) => onPasswordChange(event.target.value)}
              className="min-w-0 border-0 bg-transparent p-0 text-sm leading-5 font-medium outline-none placeholder:text-[#0f172a] disabled:opacity-60"
            />
          </label>
          {fieldErrors.password ? (
            <p id="password-error" className="text-xs text-red-700">
              {fieldErrors.password}
            </p>
          ) : null}

          {formError ? (
            <p
              role="alert"
              aria-live="polite"
              className="text-xs leading-5 text-red-700"
            >
              {formError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="flex min-h-[37px] w-[206px] items-center justify-center gap-2 rounded-full bg-[#2563eb] px-[18px] py-[10px] text-xs leading-[17px] font-medium text-white hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] disabled:cursor-wait disabled:opacity-65"
          >
            {isSubmitting ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
              />
            ) : null}
            {isSubmitting ? 'Masuk…' : 'Masuk'}
          </button>

          <p className="text-[11px] leading-4 text-[#64748b]">
            Demo environment · Sintetis data hanya
          </p>
        </form>
      </section>
    </AuthPageLayout>
  )
}

export function SessionExpiredView({
  onLoginAgain,
}: {
  onLoginAgain: () => void
}) {
  return (
    <main className="login-page flex min-h-screen items-center justify-center bg-[#f8fafc] px-6 py-12 text-[#0f172a]">
      <section
        className="w-full max-w-[600px] rounded-2xl border border-[#e2e8f0] bg-white p-4 lg:min-h-[290px]"
        aria-labelledby="session-expired-title"
      >
        <div className="flex items-center justify-between gap-4">
          <h2
            id="session-expired-title"
            className="text-lg leading-[26px] font-semibold"
          >
            Session Expired
          </h2>
          <span className="rounded-full border border-[#2563eb] bg-white px-2 py-1 text-[11px] font-medium">
            AUTH
          </span>
        </div>
        <p className="mt-3 text-xs leading-[17px] text-[#64748b]">
          Your session adalah no longer valid. Masuk again to continue.
        </p>
        <div className="mt-3 min-h-[130px] rounded-2xl bg-[#f8fafc] p-[14px]">
          <p className="text-[13px] leading-[19px] font-medium">
            Preserve no unsaved sensitive mutation implicitly. authentication
            layer decides whether safe draft data dapat menjadi recovered
            setelah re-authentication.
          </p>
        </div>
        <button
          type="button"
          onClick={onLoginAgain}
          className="mt-3 text-xs leading-[17px] font-medium text-[#2563eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
        >
          Masuk again →
        </button>
      </section>
    </main>
  )
}
