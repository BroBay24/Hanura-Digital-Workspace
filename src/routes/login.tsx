import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { LoginFieldErrors } from '#/integrations/better-auth/login-view'
import {
  LoginView,
  SessionExpiredView,
} from '#/integrations/better-auth/login-view'
import {
  AuthApiError,
  authSessionQueryKey,
  fetchAuthSession,
  loginWithPassword,
  postLoginDestination,
  useAuthSession,
} from '#/lib/session-client'

const loginSearchSchema = z.object({
  reason: z.enum(['session-expired']).optional(),
})

export const validateLoginInput = (input: {
  email: string
  password: string
}) => {
  const errors: LoginFieldErrors = {}
  const email = input.email.trim()
  if (!email) {
    errors.email = 'Email wajib diisi.'
  } else if (!z.email().safeParse(email).success) {
    errors.email = 'Email tidak valid.'
  }
  if (!input.password) {
    errors.password = 'Password wajib diisi.'
  }
  return { data: { email, password: input.password }, errors }
}

export const Route = createFileRoute('/login')({
  validateSearch: (search) => loginSearchSchema.parse(search),
  head: () => ({
    meta: [{ title: 'Masuk · Hanura Digital Workspace' }],
  }),
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sessionQuery = useAuthSession()
  const { reason } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({})
  const [formError, setFormError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (sessionQuery.data?.data.authenticated) {
      void navigate({ to: postLoginDestination, replace: true })
    }
  }, [navigate, sessionQuery.data])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const parsed = validateLoginInput({ email, password })
    if (Object.keys(parsed.errors).length > 0) {
      setFieldErrors(parsed.errors)
      setFormError(undefined)
      return
    }

    setFieldErrors({})
    setFormError(undefined)
    setIsSubmitting(true)

    try {
      await loginWithPassword(parsed.data)
      const nextSession = await queryClient.fetchQuery({
        queryKey: authSessionQueryKey,
        queryFn: () => fetchAuthSession(),
        staleTime: 0,
      })
      if (!nextSession.data.authenticated) {
        throw new Error('Session was not established')
      }
      await navigate({ to: postLoginDestination, replace: true })
    } catch (error) {
      if (error instanceof AuthApiError) {
        if (error.code === 'INVALID_CREDENTIALS') {
          setFormError('Email atau kata sandi tidak valid.')
        } else if (error.code === 'VALIDATION_ERROR') {
          const backendFieldErrors = error.fieldErrors ?? {}
          setFieldErrors({
            email: backendFieldErrors.email?.[0],
            password: backendFieldErrors.password?.[0],
          })
          setFormError('Periksa kembali data yang Anda masukkan.')
        } else {
          setFormError('Layanan sedang bermasalah. Silakan coba lagi.')
          if (error.correlationId) {
            console.error('Login request failed', {
              correlationId: error.correlationId,
            })
          }
        }
      } else {
        setFormError('Tidak dapat terhubung. Periksa jaringan dan coba lagi.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (sessionQuery.isPending || sessionQuery.data?.data.authenticated) {
    return (
      <main className="login-page flex min-h-screen items-center justify-center bg-[#f8fafc] px-6 font-sans text-[#64748b]">
        <div role="status" className="flex items-center gap-3 text-sm">
          <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
          {sessionQuery.data?.data.authenticated
            ? 'Membuka ruang kerja…'
            : 'Memeriksa sesi…'}
        </div>
      </main>
    )
  }

  if (sessionQuery.isError) {
    return (
      <main className="login-page flex min-h-screen items-center justify-center bg-[#f8fafc] px-6 font-sans text-[#0f172a]">
        <section className="w-full max-w-[460px] rounded-2xl border border-[#e2e8f0] bg-white p-9">
          <h1 className="text-[28px] leading-[41px] font-semibold">
            Tidak dapat memeriksa sesi
          </h1>
          <p className="mt-3 text-[13px] leading-[19px] text-[#64748b]">
            Periksa jaringan dan coba lagi.
          </p>
          <button
            type="button"
            onClick={() => void sessionQuery.refetch()}
            className="mt-6 rounded-full bg-[#2563eb] px-[18px] py-[10px] text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
          >
            Coba lagi
          </button>
        </section>
      </main>
    )
  }

  if (reason === 'session-expired') {
    return (
      <SessionExpiredView
        onLoginAgain={() =>
          void navigate({ to: '/login', search: {}, replace: true })
        }
      />
    )
  }

  return (
    <LoginView
      email={email}
      password={password}
      fieldErrors={fieldErrors}
      formError={formError}
      isSubmitting={isSubmitting}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={submit}
    />
  )
}
