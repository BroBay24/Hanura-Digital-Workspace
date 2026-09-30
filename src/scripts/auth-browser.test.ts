import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { session } from '#/db/schema'
import { serverEnv } from '#/env.server'
import { demoIdentities } from './provision-demo-auth.ts'

type CdpMessage = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message: string }
}

class CdpClient {
  private id = 0
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private listeners = new Map<
    string,
    Set<(params: Record<string, unknown>) => void>
  >()

  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      if (!message.method) return
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params ?? {})
      }
    })
  }

  static async connect(url: string) {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener(
        'error',
        () => reject(new Error('Chrome DevTools connection failed')),
        { once: true },
      )
    })
    return new CdpClient(socket)
  }

  send<T>(method: string, params: Record<string, unknown> = {}) {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.id
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  once<T extends Record<string, unknown>>(method: string, timeout = 10_000) {
    return new Promise<T>((resolve, reject) => {
      const listeners = this.listeners.get(method) ?? new Set()
      const listener = (params: Record<string, unknown>) => {
        clearTimeout(timer)
        listeners.delete(listener)
        resolve(params as T)
      }
      const timer = setTimeout(() => {
        listeners.delete(listener)
        reject(new Error(`Timed out waiting for ${method}`))
      }, timeout)
      listeners.add(listener)
      this.listeners.set(method, listeners)
    })
  }

  async evaluate<T>(expression: string) {
    const response = await this.send<{
      result: { value?: T }
      exceptionDetails?: unknown
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.exceptionDetails) {
      throw new Error(`Browser evaluation failed: ${expression.slice(0, 80)}`)
    }
    return response.result.value as T
  }

  async navigate(url: string) {
    const loaded = this.once('Page.loadEventFired')
    await this.send('Page.navigate', { url })
    await loaded
  }

  async waitFor(expression: string, timeout = 15_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate<boolean>(expression)) return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out waiting for browser state: ${expression}`)
  }

  close() {
    this.socket.close()
  }
}

const origin = new URL(serverEnv.BETTER_AUTH_URL).origin
const password = serverEnv.HDW_DEMO_PASSWORD
const chromePath = process.env.CHROME_BIN ?? '/usr/bin/google-chrome'

if (!password) throw new Error('HDW_DEMO_PASSWORD is required')

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrator',
  CHAIRMAN: 'Ketua / Pengurus',
  CREDIT_OFFICER: 'Petugas Kredit',
  MANAGER: 'Manajer',
  TELLER: 'Teller / Staf',
}

const launchChrome = async (profile: string) => {
  assert.ok(existsSync(chromePath), `Chrome not found: ${chromePath}`)
  const process = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `${origin}/login`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  )
  const browserUrl = await new Promise<string>((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(
      () => reject(new Error('Chrome did not start')),
      15_000,
    )
    process.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (!match) return
      clearTimeout(timer)
      resolve(match[1])
    })
    process.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Chrome exited before DevTools was ready: ${code}`))
    })
  })
  const endpoint = new URL(browserUrl)
  const targets = (await fetch(
    `http://${endpoint.hostname}:${endpoint.port}/json/list`,
  ).then((response) => response.json())) as Array<{
    type: string
    webSocketDebuggerUrl: string
  }>
  const page = targets.find(({ type }) => type === 'page')
  assert.ok(page)
  return { process, client: await CdpClient.connect(page.webSocketDebuggerUrl) }
}

const stopProcessGroup = async (
  child: ReturnType<typeof spawn> | undefined,
) => {
  if (!child?.pid) return
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
  process.kill(-child.pid, 'SIGTERM')
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}

const stopChrome = async (
  chrome: Awaited<ReturnType<typeof launchChrome>> | undefined,
) => {
  if (!chrome) return
  chrome.client.close()
  await stopProcessGroup(chrome.process)
}

const launchApp = async () => {
  const app = spawn('pnpm', ['dev'], {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    env: process.env,
  })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/login`)
      if (response.ok) return app
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await stopProcessGroup(app)
  throw new Error('Application server did not start')
}

const setInput = (id: string, value: string) =>
  `(() => { const input = document.querySelector(${JSON.stringify(`#${id}`)}); if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`

const submitLogin = async (
  client: CdpClient,
  email: string,
  candidatePassword: string,
  verifyLoading = false,
) => {
  await client.waitFor(
    "document.querySelector('#email') instanceof HTMLInputElement",
  )
  assert.equal(await client.evaluate(setInput('email', email)), true)
  assert.equal(
    await client.evaluate(setInput('password', candidatePassword)),
    true,
  )

  if (verifyLoading) {
    await client.send('Fetch.enable', {
      patterns: [
        { urlPattern: '*/api/v1/auth/login', requestStage: 'Request' },
      ],
    })
    const paused = client.once<{ requestId: string }>('Fetch.requestPaused')
    await client.evaluate(
      "document.querySelector('form')?.requestSubmit(); true",
    )
    const request = await paused
    await client.waitFor(
      "document.querySelector('button[type=submit]')?.getAttribute('aria-busy') === 'true' && document.body.textContent?.includes('Masuk…')",
    )
    await client.send('Fetch.continueRequest', { requestId: request.requestId })
    await client.send('Fetch.disable')
    return
  }

  await client.evaluate("document.querySelector('form')?.requestSubmit(); true")
}

const clickButton = (label: string) =>
  `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().includes(${JSON.stringify(label)})); button?.click(); return Boolean(button) })()`

const unauthenticatedBody = {
  data: {
    authenticated: false,
    user: null,
    session: null,
    authorization: null,
  },
}

test(
  'browser authentication and session UX integrates with the application contract',
  { timeout: 120_000 },
  async (context) => {
    const profile = await mkdtemp(join(tmpdir(), 'hdw-auth-browser-'))
    const baselineSessionIds = new Set(
      (await db.select({ id: session.id }).from(session)).map(({ id }) => id),
    )
    let app: ReturnType<typeof spawn> | undefined
    let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined

    try {
      app = await launchApp()
      chrome = await launchChrome(profile)
      const { client } = chrome
      await client.send('Page.enable')
      await client.send('Runtime.enable')
      await client.send('Network.enable')
      await client.waitFor(
        "document.querySelector('#email') instanceof HTMLInputElement",
      )

      await context.test(
        'invalid, unknown, and malformed login states are safe',
        async () => {
          for (const email of [
            demoIdentities[0].email,
            'unknown.demo@hanura.local',
          ]) {
            await submitLogin(client, email, `${password}-invalid`)
            await client.waitFor(
              "document.querySelector('[role=alert]')?.textContent?.includes('Email atau kata sandi tidak valid.')",
            )
            assert.equal(
              await client.evaluate("location.pathname === '/login'"),
              true,
            )
            await client.navigate(`${origin}/login`)
            await client.waitFor(
              "document.querySelector('#email') instanceof HTMLInputElement",
            )
          }

          await submitLogin(client, 'invalid', password)
          await client.waitFor(
            "document.querySelector('#email-error')?.textContent?.includes('Email tidak valid.')",
          )
          assert.equal(
            await client.evaluate("location.pathname === '/login'"),
            true,
          )
        },
      )

      for (const identity of demoIdentities) {
        await context.test(
          `${identity.role} authenticates and logs out`,
          async () => {
            await client.send('Network.clearBrowserCookies')
            await client.navigate(`${origin}/login`)
            await submitLogin(client, identity.email, password)
            await client.waitFor(
              "location.pathname === '/' && document.body.textContent?.includes('Sesi aktif')",
            )

            const apiSession = await client.evaluate<{
              data: {
                authenticated: boolean
                user: { email: string }
                authorization: { roles: Array<string> }
              }
            }>(
              "fetch('/api/v1/auth/session').then((response) => response.json())",
            )
            assert.equal(apiSession.data.authenticated, true)
            assert.equal(apiSession.data.user.email, identity.email)
            assert.deepEqual(apiSession.data.authorization.roles, [
              identity.role,
            ])

            const text = await client.evaluate<string>(
              'document.body.innerText',
            )
            assert.match(text, new RegExp(roleLabels[identity.role]))
            assert.doesNotMatch(
              text,
              /approval\.|admin\.user_access|settings\.manage/,
            )
            const storage = await client.evaluate<{
              local: Array<string>
              session: Array<string>
            }>(
              '({ local: Object.values(localStorage), session: Object.values(sessionStorage) })',
            )
            for (const value of [...storage.local, ...storage.session]) {
              assert.equal(value.includes(password), false)
              assert.doesNotMatch(value, /session[_-]?token|bearer\s|jwt/i)
            }

            const cookies = await client.send<{
              cookies: Array<{
                name: string
                httpOnly: boolean
                sameSite?: string
                secure: boolean
              }>
            }>('Network.getAllCookies')
            const authCookie = cookies.cookies.find(({ name }) =>
              name.includes('session_token'),
            )
            assert.ok(authCookie)
            assert.equal(authCookie.httpOnly, true)
            assert.equal(authCookie.sameSite, 'Lax')
            assert.equal(
              authCookie.secure,
              process.env.NODE_ENV === 'production' ||
                origin.startsWith('https://'),
            )

            assert.equal(
              await client.evaluate(
                "document.querySelector('summary')?.click(); true",
              ),
              true,
            )
            assert.equal(await client.evaluate(clickButton('Keluar')), true)
            await client.waitFor("location.pathname === '/login'")
            assert.deepEqual(
              await client.evaluate(
                "fetch('/api/v1/auth/session').then((response) => response.json())",
              ),
              unauthenticatedBody,
            )
          },
        )
      }

      await context.test(
        'loading, authenticated redirect, and account data are safe',
        async () => {
          await client.send('Network.clearBrowserCookies')
          await client.navigate(`${origin}/login`)
          await submitLogin(client, demoIdentities[1].email, password, true)
          await client.waitFor(
            "location.pathname === '/' && document.body.textContent?.includes('Sesi aktif')",
          )
          await client.navigate(`${origin}/login`)
          await client.waitFor(
            "location.pathname === '/' && document.body.textContent?.includes('Sesi aktif')",
          )
          await new Promise((resolve) => setTimeout(resolve, 500))
          assert.equal(await client.evaluate("location.pathname === '/'"), true)

          await client.evaluate(
            "document.querySelector('summary')?.click(); true",
          )
          const text = await client.evaluate<string>('document.body.innerText')
          assert.match(text, /Demo Manager/)
          assert.match(text, /manager\.demo@hanura\.local/)
          assert.match(text, /Manajer/)
          assert.doesNotMatch(
            text,
            /demo-user-manager|approval\.manager\.decide|session_token/,
          )
        },
      )

      await context.test(
        'deleted session shows expired UX and permits re-login',
        async () => {
          const createdSessions = (
            await db.select({ id: session.id }).from(session)
          ).filter(({ id }) => !baselineSessionIds.has(id))
          assert.equal(createdSessions.length, 1)
          const [createdSession] = createdSessions
          assert.ok(createdSession)
          await db.delete(session).where(eq(session.id, createdSession.id))

          await client.waitFor(
            "location.pathname === '/login' && new URLSearchParams(location.search).get('reason') === 'session-expired' && document.body.textContent?.includes('Session Expired')",
            70_000,
          )
          await new Promise((resolve) => setTimeout(resolve, 500))
          assert.equal(
            await client.evaluate(
              "location.pathname === '/login' && document.body.textContent?.includes('Session Expired')",
            ),
            true,
          )
          assert.equal(await client.evaluate(clickButton('Masuk again')), true)
          await client.waitFor(
            "document.querySelector('#email') instanceof HTMLInputElement",
          )
          await submitLogin(client, demoIdentities[1].email, password)
          await client.waitFor(
            "location.pathname === '/' && document.body.textContent?.includes('Sesi aktif')",
          )
          await client.evaluate(
            "document.querySelector('summary')?.click(); true",
          )
          assert.equal(await client.evaluate(clickButton('Keluar')), true)
          await client.waitFor("location.pathname === '/login'")
        },
      )

      await context.test('narrow viewport keeps login usable', async () => {
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: 390,
          height: 844,
          deviceScaleFactor: 1,
          mobile: true,
        })
        await client.navigate(`${origin}/login`)
        await client.waitFor(
          "document.querySelector('#email') instanceof HTMLInputElement",
        )
        const layout = await client.evaluate<{
          width: number
          emailWidth: number
          passwordWidth: number
          buttonWidth: number
        }>(`(() => {
          const email = document.querySelector('#email')?.getBoundingClientRect()
          const passwordInput = document.querySelector('#password')?.getBoundingClientRect()
          const button = document.querySelector('button[type=submit]')?.getBoundingClientRect()
          return {
            width: document.documentElement.scrollWidth,
            emailWidth: email?.width ?? 0,
            passwordWidth: passwordInput?.width ?? 0,
            buttonWidth: button?.width ?? 0,
          }
        })()`)
        assert.ok(layout.width <= 390)
        assert.ok(layout.emailWidth > 0)
        assert.ok(layout.passwordWidth > 0)
        assert.ok(layout.buttonWidth > 0)
      })
    } finally {
      await stopChrome(chrome)
      await stopProcessGroup(app)
      const createdSessionIds = (
        await db.select({ id: session.id }).from(session)
      )
        .filter(({ id }) => !baselineSessionIds.has(id))
        .map(({ id }) => id)
      if (createdSessionIds.length > 0) {
        await db.delete(session).where(inArray(session.id, createdSessionIds))
      }
      await db.$client.end()
      await rm(profile, { recursive: true, force: true, maxRetries: 5 })
    }
  },
)
