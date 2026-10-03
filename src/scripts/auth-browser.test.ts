import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { roles, session, user, userRoles } from '#/db/schema'
import { serverEnv } from '#/env.server'
import { auth } from '#/lib/auth'
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

const roleNames: Record<string, string> = {
  ADMIN: 'Demo Administrator',
  CHAIRMAN: 'Demo Ketua',
  CREDIT_OFFICER: 'Demo Petugas Kredit',
  MANAGER: 'Demo Manager',
  TELLER: 'Demo Teller',
}

const roleDashboardSections: Record<string, Array<string>> = {
  ADMIN: [
    'access-summary',
    'audit-summary',
    'integration-status',
    'settings-summary',
  ],
  CHAIRMAN: [
    'member-overview',
    'member-snapshot-health',
    'chairman-approval-queue',
    'operational-report',
  ],
  CREDIT_OFFICER: [
    'member-overview',
    'member-snapshot-health',
    'loan-workflow',
    'document-workload',
    'credit-review-workload',
  ],
  MANAGER: [
    'member-overview',
    'member-snapshot-health',
    'manager-approval-queue',
    'operational-report',
  ],
  TELLER: ['member-overview', 'member-snapshot-health'],
}

const roleNavigation: Record<string, Array<string>> = {
  ADMIN: [
    'dashboard',
    'users-access',
    'activity',
    'integration-status',
    'settings',
  ],
  CHAIRMAN: ['dashboard', 'members', 'approvals', 'reports'],
  CREDIT_OFFICER: ['dashboard', 'members', 'loans', 'documents'],
  MANAGER: ['dashboard', 'members', 'approvals', 'reports'],
  TELLER: ['dashboard', 'members'],
}

const temporaryIdentities = {
  noRole: {
    email: 'no-role.integration@hanura.local',
    name: 'Integration No Role',
  },
  multiRole: {
    email: 'multi-role.integration@hanura.local',
    name: 'Integration Multi Role',
  },
} as const

const temporaryEmails = Object.values(temporaryIdentities).map(
  ({ email }) => email,
)

const setupTemporaryIdentities = async () => {
  await db.delete(user).where(inArray(user.email, temporaryEmails))
  await auth.api.signUpEmail({
    body: { ...temporaryIdentities.noRole, password },
  })
  const multiRole = await auth.api.signUpEmail({
    body: { ...temporaryIdentities.multiRole, password },
  })
  const assignedRoles = await db
    .select({ id: roles.id, code: roles.code })
    .from(roles)
    .where(inArray(roles.code, ['CREDIT_OFFICER', 'MANAGER', 'TELLER']))
  const roleByCode = new Map(assignedRoles.map((role) => [role.code, role.id]))
  const creditOfficerRole = roleByCode.get('CREDIT_OFFICER')
  const managerRole = roleByCode.get('MANAGER')
  const tellerRole = roleByCode.get('TELLER')
  assert.ok(creditOfficerRole)
  assert.ok(managerRole)
  assert.ok(tellerRole)
  await db.insert(userRoles).values([
    { userId: multiRole.user.id, roleId: creditOfficerRole },
    { userId: multiRole.user.id, roleId: managerRole },
  ])
  return {
    multiRoleUserId: multiRole.user.id,
    tellerRoleId: tellerRole,
  }
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
  { timeout: 180_000 },
  async (context) => {
    const profile = await mkdtemp(join(tmpdir(), 'hdw-auth-browser-'))
    let baselineSessionIds = new Set<string>()
    let temporaryFixture:
      Awaited<ReturnType<typeof setupTemporaryIdentities>> | undefined
    let app: ReturnType<typeof spawn> | undefined
    let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined

    try {
      temporaryFixture = await setupTemporaryIdentities()
      baselineSessionIds = new Set(
        (await db.select({ id: session.id }).from(session)).map(({ id }) => id),
      )
      app = await launchApp()
      chrome = await launchChrome(profile)
      const { client } = chrome
      await client.send('Page.enable')
      await client.send('Runtime.enable')
      await client.send('Network.enable')
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await client.waitFor(
        "document.querySelector('#email') instanceof HTMLInputElement",
      )

      await context.test(
        'direct unauthenticated shell access redirects without protected content',
        async () => {
          await client.send('Network.clearBrowserCookies')
          const initial = await fetch(`${origin}/`, { redirect: 'manual' })
          assert.ok([301, 302, 307, 308].includes(initial.status))
          assert.equal(
            new URL(initial.headers.get('location') ?? '', origin).pathname,
            '/login',
          )
          assert.doesNotMatch(
            await initial.text(),
            /Sesi aktif|Ruang kerja siap digunakan|data-app-shell="true"/,
          )

          await client.navigate(`${origin}/`)
          await client.waitFor(
            "location.pathname === '/login' && document.querySelector('#email') instanceof HTMLInputElement",
          )
          assert.equal(
            await client.evaluate(
              "document.querySelectorAll('[data-app-shell=true]').length",
            ),
            0,
          )
          const text = await client.evaluate<string>('document.body.innerText')
          assert.doesNotMatch(text, /Sesi aktif|Ruang kerja siap digunakan/)
          const dashboardStatus = await client.evaluate<number>(
            "fetch('/api/v1/dashboard').then((response) => response.status)",
          )
          assert.equal(dashboardStatus, 401)
        },
      )

      await context.test(
        'session API polling failure remains a recoverable shell error',
        async () => {
          await client.send('Network.clearBrowserCookies')
          const loginStatus = await client.evaluate<number>(
            `fetch('/api/v1/auth/login', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: ${JSON.stringify(demoIdentities[1].email)}, password: ${JSON.stringify(password)} }),
            }).then((response) => response.status)`,
          )
          assert.equal(loginStatus, 200)
          await client.navigate(`${origin}/`)
          await client.waitFor(
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )

          await client.send('Fetch.enable', {
            patterns: [
              {
                urlPattern: '*/api/v1/auth/session',
                requestStage: 'Request',
              },
            ],
          })
          const paused = client.once<{ requestId: string }>(
            'Fetch.requestPaused',
            70_000,
          )
          const request = await paused
          await client.send('Fetch.fulfillRequest', {
            requestId: request.requestId,
            responseCode: 500,
            responseHeaders: [
              { name: 'content-type', value: 'application/json' },
              { name: 'cache-control', value: 'no-store' },
            ],
            body: Buffer.from(
              JSON.stringify({
                error: {
                  code: 'INTERNAL_ERROR',
                  message: 'Layanan sedang bermasalah.',
                  correlationId: 'shell-browser-test',
                },
              }),
            ).toString('base64'),
          })
          await client.send('Fetch.disable')
          await client.waitFor(
            "location.pathname === '/' && document.body.textContent?.includes('Ruang kerja tidak dapat dimuat') && document.body.textContent?.includes('Coba lagi')",
          )
          assert.equal(
            await client.evaluate(
              "Boolean(document.querySelector('[data-dashboard-page=true]'))",
            ),
            false,
          )
          assert.equal(
            await client.evaluate(
              "document.querySelector('header[data-app-header=true] h1')?.textContent?.trim()",
            ),
            'Dasbor',
          )

          const logoutStatus = await client.evaluate<number>(
            "fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }).then((response) => response.status)",
          )
          assert.equal(logoutStatus, 200)
          await client.send('Network.clearBrowserCookies')
          await client.navigate(`${origin}/login`)
          await client.waitFor(
            "document.querySelector('#email') instanceof HTMLInputElement",
          )
        },
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
              "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
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
            const dashboard = await client.evaluate<{
              status: number
              body: {
                data: {
                  context: { degraded: boolean; degradedSources: Array<string> }
                  sections: Array<{
                    id: string
                    source: { financialSourceOfTruth: boolean }
                    metrics: Array<{ key: string; unit: string; value: number }>
                  }>
                }
              }
            }>(`fetch('/api/v1/dashboard?role=ADMIN&permission=*', {
              headers: { 'x-role': 'ADMIN', 'x-permission': '*' },
            }).then(async (response) => ({ status: response.status, body: await response.json() }))`)
            assert.equal(dashboard.status, 200)
            assert.deepEqual(
              dashboard.body.data.sections.map(({ id }) => id),
              roleDashboardSections[identity.role],
            )
            assert.equal(dashboard.body.data.context.degraded, false)
            assert.deepEqual(dashboard.body.data.context.degradedSources, [])
            for (const section of dashboard.body.data.sections) {
              assert.equal(section.source.financialSourceOfTruth, false)
              assert.equal(
                section.metrics.every(({ unit }) => unit === 'count'),
                true,
              )
            }
            assert.doesNotMatch(
              JSON.stringify(dashboard.body),
              /requestedAmount|outstanding|portfolio balance|sessionToken|secret/i,
            )
            const renderedDashboard = await client.evaluate<{
              sectionIds: Array<string>
              metricKeys: Array<string>
              metricValues: Array<string>
              headingCount: number
              horizontalOverflow: boolean
              text: string
            }>(`(() => ({
              sectionIds: [...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getAttribute('data-dashboard-section') ?? ''),
              metricKeys: [...document.querySelectorAll('[data-dashboard-metric]')].map((item) => item.getAttribute('data-dashboard-metric') ?? ''),
              metricValues: [...document.querySelectorAll('[data-dashboard-metric] dd')].map((item) => item.textContent?.trim() ?? ''),
              headingCount: document.querySelectorAll('h1').length,
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              text: document.querySelector('[data-dashboard-page=true]')?.textContent ?? '',
            }))()`)
            assert.deepEqual(
              renderedDashboard.sectionIds,
              roleDashboardSections[identity.role],
            )
            assert.deepEqual(
              renderedDashboard.metricKeys,
              dashboard.body.data.sections.flatMap(({ metrics }) =>
                metrics.map(({ key }) => key),
              ),
            )
            assert.deepEqual(
              renderedDashboard.metricValues,
              dashboard.body.data.sections.flatMap(({ metrics }) =>
                metrics.map(({ value }) => value.toLocaleString('id-ID')),
              ),
            )
            assert.equal(renderedDashboard.headingCount, 1)
            assert.equal(renderedDashboard.horizontalOverflow, false)
            assert.doesNotMatch(
              renderedDashboard.text,
              /saldo resmi|portfolio resmi|outstanding resmi|performing loans|assigned to you|hari ini/i,
            )
            const screenshot = await client.send<{ data: string }>(
              'Page.captureScreenshot',
              { format: 'png', fromSurface: true },
            )
            assert.ok(screenshot.data.length > 1000)

            assert.equal(
              await client.evaluate(
                "document.querySelectorAll('[data-app-shell=true]').length",
              ),
              1,
            )
            assert.equal(
              await client.evaluate(
                "Boolean(document.querySelector('nav[aria-label=\"Navigasi utama\"]') && document.querySelector('main#main-content [data-dashboard-page=true]'))",
              ),
              true,
            )
            const header = await client.evaluate<{
              count: number
              height: number
              title: string
              subtitle: string
              headingCount: number
              accountLabel: string | null
            }>(`(() => {
              const header = document.querySelector('header[data-app-header=true]')
              return {
                count: document.querySelectorAll('header[data-app-header=true]').length,
                height: header?.getBoundingClientRect().height ?? 0,
                title: header?.querySelector('h1')?.textContent?.trim() ?? '',
                subtitle: header?.querySelector('h1 + p')?.textContent?.trim() ?? '',
                headingCount: document.querySelectorAll('h1').length,
                accountLabel: header?.querySelector('summary')?.getAttribute('aria-label') ?? null,
              }
            })()`)
            assert.deepEqual(header, {
              count: 1,
              height: 72,
              title: 'Dasbor',
              subtitle: 'Ruang Kerja Digital Hanura',
              headingCount: 1,
              accountLabel: `Buka menu akun untuk ${roleNames[identity.role]}`,
            })
            const navigation = await client.evaluate<{
              ids: Array<string>
              disabledIds: Array<string>
              hrefs: Array<string>
              activeIds: Array<string>
            }>(`(() => {
              const nav = document.querySelector('aside nav[aria-label="Navigasi utama"]')
              const items = [...(nav?.querySelectorAll('[data-navigation-item]') ?? [])]
              return {
                ids: items.map((item) => item.getAttribute('data-navigation-item') ?? ''),
                disabledIds: items.filter((item) => item.getAttribute('aria-disabled') === 'true').map((item) => item.getAttribute('data-navigation-item') ?? ''),
                hrefs: [...(nav?.querySelectorAll('a[href]') ?? [])].map((item) => item.getAttribute('href') ?? ''),
                activeIds: items.filter((item) => item.getAttribute('aria-current') === 'page').map((item) => item.getAttribute('data-navigation-item') ?? ''),
              }
            })()`)
            assert.deepEqual(navigation.ids, roleNavigation[identity.role])
            assert.deepEqual(
              navigation.disabledIds,
              roleNavigation[identity.role].filter((id) => id !== 'dashboard'),
            )
            assert.deepEqual(navigation.hrefs, ['/'])
            assert.deepEqual(navigation.activeIds, ['dashboard'])
            assert.equal(
              await client.evaluate(
                'getComputedStyle(document.querySelector(\'aside [data-navigation-item="dashboard"]\')).color',
              ),
              'rgb(255, 255, 255)',
            )
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

            await client.navigate(`${origin}/`)
            await client.waitFor(
              "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
            )
            assert.deepEqual(
              await client.evaluate<Array<string>>(
                "[...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getAttribute('data-dashboard-section') ?? '')",
              ),
              roleDashboardSections[identity.role],
            )
            assert.deepEqual(
              await client.evaluate<Array<string>>(
                "[...document.querySelectorAll('aside [data-navigation-item]')].map((item) => item.getAttribute('data-navigation-item') ?? '')",
              ),
              roleNavigation[identity.role],
            )

            assert.equal(
              await client.evaluate(
                "document.querySelector('summary')?.click(); true",
              ),
              true,
            )
            const accountText = await client.evaluate<string>(
              "document.querySelector('.account-menu')?.innerText ?? ''",
            )
            assert.match(accountText, new RegExp(roleNames[identity.role]))
            assert.match(
              accountText,
              new RegExp(identity.email.replace('.', '\\.')),
            )
            assert.match(accountText, new RegExp(roleLabels[identity.role]))
            assert.doesNotMatch(
              accountText,
              /demo-user-|approval\.|admin\.user_access|session_token/,
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
        'dashboard cache is isolated across ADMIN to TELLER and CHAIRMAN to CREDIT_OFFICER switches',
        async () => {
          const switches = [
            {
              from: demoIdentities[4],
              to: demoIdentities[3],
              forbidden: 'access-summary',
            },
            {
              from: demoIdentities[0],
              to: demoIdentities[2],
              forbidden: 'chairman-approval-queue',
            },
          ]

          for (const switchCase of switches) {
            await client.send('Network.clearBrowserCookies')
            await client.navigate(`${origin}/login`)
            await submitLogin(client, switchCase.from.email, password)
            await client.waitFor(
              "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
            )
            assert.deepEqual(
              await client.evaluate<Array<string>>(
                "[...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getAttribute('data-dashboard-section') ?? '')",
              ),
              roleDashboardSections[switchCase.from.role],
            )
            await client.evaluate(
              "document.querySelector('summary')?.click(); true",
            )
            assert.equal(await client.evaluate(clickButton('Keluar')), true)
            await client.waitFor("location.pathname === '/login'")

            await client.send('Fetch.enable', {
              patterns: [
                { urlPattern: '*/api/v1/dashboard', requestStage: 'Request' },
              ],
            })
            const pausedDashboard = client.once<{ requestId: string }>(
              'Fetch.requestPaused',
            )
            await submitLogin(client, switchCase.to.email, password)
            const paused = await pausedDashboard
            await client.waitFor(
              "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-loading=true]'))",
            )
            assert.equal(
              await client.evaluate(
                `document.querySelector('[data-dashboard-section=${switchCase.forbidden}]') === null`,
              ),
              true,
            )
            assert.equal(
              await client.evaluate(
                "document.querySelectorAll('[data-dashboard-section]').length",
              ),
              0,
            )
            await client.send('Fetch.continueRequest', {
              requestId: paused.requestId,
            })
            await client.send('Fetch.disable')
            await client.waitFor(
              "Boolean(document.querySelector('[data-dashboard-page=true]'))",
            )
            assert.deepEqual(
              await client.evaluate<Array<string>>(
                "[...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getAttribute('data-dashboard-section') ?? '')",
              ),
              roleDashboardSections[switchCase.to.role],
            )
            await client.evaluate(
              "document.querySelector('summary')?.click(); true",
            )
            assert.equal(await client.evaluate(clickButton('Keluar')), true)
            await client.waitFor("location.pathname === '/login'")
          }
        },
      )

      await context.test(
        'temporary missing-role and multi-role users compose safely and refresh DB permissions',
        async () => {
          assert.ok(temporaryFixture)
          await client.send('Network.clearBrowserCookies')
          await client.navigate(`${origin}/login`)
          await submitLogin(client, temporaryIdentities.noRole.email, password)
          await client.waitFor(
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-empty=true]'))",
          )
          assert.deepEqual(
            await client.evaluate<Array<string>>(
              "[...document.querySelectorAll('aside [data-navigation-item]')].map((item) => item.getAttribute('data-navigation-item') ?? '')",
            ),
            ['dashboard'],
          )
          assert.equal(
            await client.evaluate(
              "document.querySelectorAll('[data-dashboard-section]').length",
            ),
            0,
          )
          assert.equal(
            await client.evaluate(
              "document.querySelector('.account-menu')?.textContent?.includes('Pengguna')",
            ),
            true,
          )
          await client.evaluate(
            "document.querySelector('summary')?.click(); true",
          )
          assert.equal(await client.evaluate(clickButton('Keluar')), true)
          await client.waitFor("location.pathname === '/login'")

          await submitLogin(
            client,
            temporaryIdentities.multiRole.email,
            password,
          )
          await client.waitFor(
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )
          assert.deepEqual(
            await client.evaluate<Array<string>>(
              "[...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getAttribute('data-dashboard-section') ?? '')",
            ),
            [
              'member-overview',
              'member-snapshot-health',
              'loan-workflow',
              'document-workload',
              'credit-review-workload',
              'manager-approval-queue',
              'operational-report',
            ],
          )
          assert.deepEqual(
            await client.evaluate<Array<string>>(
              "[...document.querySelectorAll('aside [data-navigation-item]')].map((item) => item.getAttribute('data-navigation-item') ?? '')",
            ),
            [
              'dashboard',
              'members',
              'loans',
              'approvals',
              'documents',
              'reports',
            ],
          )
          assert.equal(
            await client.evaluate(
              "new Set([...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getAttribute('data-dashboard-section'))).size === document.querySelectorAll('[data-dashboard-section]').length",
            ),
            true,
          )

          await db
            .delete(userRoles)
            .where(eq(userRoles.userId, temporaryFixture.multiRoleUserId))
          await db.insert(userRoles).values({
            userId: temporaryFixture.multiRoleUserId,
            roleId: temporaryFixture.tellerRoleId,
          })
          await client.navigate(`${origin}/`)
          await client.waitFor(
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )
          assert.deepEqual(
            await client.evaluate<Array<string>>(
              "[...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getAttribute('data-dashboard-section') ?? '')",
            ),
            roleDashboardSections.TELLER,
          )
          assert.deepEqual(
            await client.evaluate<Array<string>>(
              "[...document.querySelectorAll('aside [data-navigation-item]')].map((item) => item.getAttribute('data-navigation-item') ?? '')",
            ),
            roleNavigation.TELLER,
          )
          await client.evaluate(
            "document.querySelector('summary')?.click(); true",
          )
          assert.equal(await client.evaluate(clickButton('Keluar')), true)
          await client.waitFor("location.pathname === '/login'")
        },
      )

      await context.test(
        'dashboard loading, error, retry, empty, unavailable, and degraded states remain distinct',
        async () => {
          await client.send('Network.clearBrowserCookies')
          const loginStatus = await client.evaluate<number>(
            `fetch('/api/v1/auth/login', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: ${JSON.stringify(demoIdentities[1].email)}, password: ${JSON.stringify(password)} }),
            }).then((response) => response.status)`,
          )
          assert.equal(loginStatus, 200)

          await client.send('Fetch.enable', {
            patterns: [
              { urlPattern: '*/api/v1/dashboard', requestStage: 'Request' },
            ],
          })
          const failedRequest = client.once<{ requestId: string }>(
            'Fetch.requestPaused',
          )
          await client.navigate(`${origin}/`)
          await client.waitFor(
            "Boolean(document.querySelector('[data-dashboard-loading=true]'))",
          )
          assert.equal(
            await client.evaluate(
              "document.querySelectorAll('[data-dashboard-metric]').length",
            ),
            0,
          )
          const failure = await failedRequest
          await client.send('Fetch.fulfillRequest', {
            requestId: failure.requestId,
            responseCode: 500,
            responseHeaders: [
              { name: 'content-type', value: 'application/json' },
            ],
            body: Buffer.from(
              JSON.stringify({
                error: {
                  code: 'INTERNAL_ERROR',
                  message: 'Dashboard tidak dapat dimuat.',
                  correlationId: 'dashboard-ui-browser-test',
                },
              }),
            ).toString('base64'),
          })
          await client.send('Fetch.disable')
          await client.waitFor(
            "Boolean(document.querySelector('[data-dashboard-error=true][role=alert]'))",
          )

          await client.send('Fetch.enable', {
            patterns: [
              { urlPattern: '*/api/v1/dashboard', requestStage: 'Request' },
            ],
          })
          const retryRequest = client.once<{ requestId: string }>(
            'Fetch.requestPaused',
          )
          assert.equal(await client.evaluate(clickButton('Coba lagi')), true)
          const retry = await retryRequest
          await client.send('Fetch.fulfillRequest', {
            requestId: retry.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'content-type', value: 'application/json' },
            ],
            body: Buffer.from(
              JSON.stringify({
                data: {
                  context: {
                    contractVersion: '1',
                    generatedAt: '2026-02-01T00:00:00.000Z',
                    degraded: true,
                    degradedSources: ['member-core-snapshot'],
                  },
                  sections: [
                    {
                      id: 'member-overview',
                      title: 'Member reference cache overview',
                      state: 'empty',
                      source: {
                        kind: 'mock-cache',
                        label: 'Cached core member references',
                        provider: 'mock',
                        financialSourceOfTruth: false,
                      },
                      metrics: [
                        {
                          key: 'total',
                          label: 'Member references',
                          value: 0,
                          unit: 'count',
                        },
                      ],
                    },
                    {
                      id: 'member-snapshot-health',
                      title: 'Cached member snapshot health',
                      state: 'unavailable',
                      source: {
                        kind: 'provider-snapshot',
                        label: 'Cached core member snapshots',
                        financialSourceOfTruth: false,
                      },
                      metrics: [],
                      unavailableReason: 'source-unavailable',
                    },
                    {
                      id: 'operational-report',
                      title: 'Workspace workflow summary',
                      state: 'available',
                      source: {
                        kind: 'workspace-derived',
                        label: 'Derived Workspace summary',
                        financialSourceOfTruth: false,
                      },
                      metrics: [
                        {
                          key: 'applications',
                          label: 'Applications',
                          value: 3,
                          unit: 'count',
                        },
                      ],
                    },
                  ],
                },
              }),
            ).toString('base64'),
          })
          await client.send('Fetch.disable')
          await client.waitFor(
            "Boolean(document.querySelector('[data-dashboard-degraded=true]') && document.querySelector('[data-dashboard-state=empty]') && document.querySelector('[data-dashboard-state=unavailable]') && document.querySelector('[data-dashboard-section=operational-report][data-section-state=available]'))",
          )
          assert.equal(
            await client.evaluate(
              "document.querySelector('[data-dashboard-state=unavailable]')?.textContent?.includes('berbeda dari nol')",
            ),
            true,
          )

          const logoutStatus = await client.evaluate<number>(
            "fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }).then((response) => response.status)",
          )
          assert.equal(logoutStatus, 200)
          await client.send('Network.clearBrowserCookies')
          await client.navigate(`${origin}/login`)
          await client.waitFor(
            "document.querySelector('#email') instanceof HTMLInputElement",
          )
        },
      )

      await context.test(
        'dashboard network failure preserves authenticated shell and retries successfully',
        async () => {
          await client.send('Network.clearBrowserCookies')
          const loginStatus = await client.evaluate<number>(
            `fetch('/api/v1/auth/login', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: ${JSON.stringify(demoIdentities[1].email)}, password: ${JSON.stringify(password)} }),
            }).then((response) => response.status)`,
          )
          assert.equal(loginStatus, 200)
          await client.send('Fetch.enable', {
            patterns: [
              { urlPattern: '*/api/v1/dashboard', requestStage: 'Request' },
            ],
          })
          const failedRequest = client.once<{ requestId: string }>(
            'Fetch.requestPaused',
          )
          await client.navigate(`${origin}/`)
          const request = await failedRequest
          await client.send('Fetch.failRequest', {
            requestId: request.requestId,
            errorReason: 'InternetDisconnected',
          })
          await client.send('Fetch.disable')
          await client.waitFor(
            "Boolean(document.querySelector('[data-dashboard-error=true][role=alert]'))",
          )
          assert.equal(
            await client.evaluate(
              "Boolean(document.querySelector('[data-app-shell=true]') && document.querySelector('nav[aria-label=\"Navigasi utama\"]') && document.querySelector('.account-menu'))",
            ),
            true,
          )
          assert.equal(
            await client.evaluate(
              "fetch('/api/v1/auth/session').then((response) => response.json()).then((body) => body.data.authenticated)",
            ),
            true,
          )
          assert.equal(await client.evaluate(clickButton('Coba lagi')), true)
          await client.waitFor(
            "Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )
          assert.deepEqual(
            await client.evaluate<Array<string>>(
              "[...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getAttribute('data-dashboard-section') ?? '')",
            ),
            roleDashboardSections.MANAGER,
          )
          await client.evaluate(
            "document.querySelector('summary')?.click(); true",
          )
          assert.equal(await client.evaluate(clickButton('Keluar')), true)
          await client.waitFor("location.pathname === '/login'")
        },
      )

      await context.test(
        'loading, authenticated redirect, and account data are safe',
        async () => {
          await client.send('Network.clearBrowserCookies')
          await client.navigate(`${origin}/login`)
          await submitLogin(client, demoIdentities[1].email, password, true)
          await client.waitFor(
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )
          await client.navigate(`${origin}/login`)
          await client.waitFor(
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )
          await new Promise((resolve) => setTimeout(resolve, 500))
          assert.equal(await client.evaluate("location.pathname === '/'"), true)
          assert.equal(
            await client.evaluate(
              "document.querySelectorAll('[data-app-shell=true]').length",
            ),
            1,
          )

          await client.navigate(`${origin}/`)
          await client.waitFor(
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )
          const geometry = await client.evaluate<{
            sidebarWidth: number
            headerHeight: number
            mainLeft: number
            viewportWidth: number
            sectionCount: number
            sectionColumns: number
          }>(`(() => {
            const sidebar = document.querySelector('aside')?.getBoundingClientRect()
            const header = document.querySelector('header')?.getBoundingClientRect()
            const main = document.querySelector('main#main-content')?.getBoundingClientRect()
            const sections = [...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getBoundingClientRect())
            return {
              sidebarWidth: sidebar?.width ?? 0,
              headerHeight: header?.height ?? 0,
              mainLeft: main?.left ?? 0,
              viewportWidth: innerWidth,
              sectionCount: sections.length,
              sectionColumns: new Set(sections.map(({ left }) => left)).size,
            }
          })()`)
          assert.deepEqual(geometry, {
            sidebarWidth: 240,
            headerHeight: 72,
            mainLeft: 240,
            viewportWidth: 1440,
            sectionCount: 4,
            sectionColumns: 2,
          })

          await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1024,
            height: 768,
            deviceScaleFactor: 1,
            mobile: false,
          })
          const laptop = await client.evaluate<{
            viewportWidth: number
            horizontalOverflow: boolean
            sidebarWidth: number
            sectionColumns: number
          }>(`(() => ({
            viewportWidth: innerWidth,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            sidebarWidth: document.querySelector('aside')?.getBoundingClientRect().width ?? 0,
            sectionColumns: new Set([...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getBoundingClientRect().left)).size,
          }))()`)
          assert.deepEqual(laptop, {
            viewportWidth: 1024,
            horizontalOverflow: false,
            sidebarWidth: 240,
            sectionColumns: 2,
          })

          await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
          })
          assert.equal(
            await client.evaluate(
              "document.querySelector('a[href=\"#main-content\"]')?.textContent?.includes('Lewati ke konten utama')",
            ),
            true,
          )

          await client.evaluate(
            "document.querySelector('summary')?.focus(); true",
          )
          await client.send('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            key: ' ',
            code: 'Space',
            windowsVirtualKeyCode: 32,
          })
          await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: ' ',
            code: 'Space',
            windowsVirtualKeyCode: 32,
          })
          await client.waitFor(
            "document.querySelector('details.account-menu')?.hasAttribute('open') === true",
          )
          assert.equal(
            await client.evaluate('document.activeElement?.tagName'),
            'SUMMARY',
          )
          await client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Tab',
            code: 'Tab',
          })
          await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Tab',
            code: 'Tab',
          })
          assert.equal(
            await client.evaluate(
              "document.activeElement?.textContent?.trim() === 'Keluar'",
            ),
            true,
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
          await client.navigate(`${origin}/`)

          await client.waitFor(
            "location.pathname === '/login' && new URLSearchParams(location.search).get('reason') === 'session-expired' && document.body.textContent?.includes('Session Expired')",
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
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )
          await client.evaluate(
            "document.querySelector('summary')?.click(); true",
          )
          assert.equal(await client.evaluate(clickButton('Keluar')), true)
          await client.waitFor("location.pathname === '/login'")
        },
      )

      await context.test(
        'narrow viewport keeps login and protected shell usable',
        async () => {
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
          const loginLayout = await client.evaluate<{
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
          assert.ok(loginLayout.width <= 390)
          assert.ok(loginLayout.emailWidth > 0)
          assert.ok(loginLayout.passwordWidth > 0)
          assert.ok(loginLayout.buttonWidth > 0)

          await submitLogin(client, demoIdentities[1].email, password)
          await client.waitFor(
            "location.pathname === '/' && Boolean(document.querySelector('[data-dashboard-page=true]'))",
          )
          const shellLayout = await client.evaluate<{
            width: number
            shellCount: number
            sidebarWidth: number
            headerHeight: number
            triggerVisible: boolean
            triggerRight: number
            titleLeft: number
            titleRight: number
            accountLeft: number
            mainWidth: number
            sectionColumns: number
          }>(`(() => {
            const sidebar = document.querySelector('aside')?.getBoundingClientRect()
            const header = document.querySelector('header[data-app-header=true]')?.getBoundingClientRect()
            const trigger = document.querySelector('button[aria-label="Buka navigasi"]')
            const triggerBounds = trigger?.getBoundingClientRect()
            const title = document.querySelector('header[data-app-header=true] h1')?.getBoundingClientRect()
            const account = document.querySelector('header[data-app-header=true] summary')?.getBoundingClientRect()
            const main = document.querySelector('main#main-content')?.getBoundingClientRect()
            return {
              width: document.documentElement.scrollWidth,
              shellCount: document.querySelectorAll('[data-app-shell=true]').length,
              sidebarWidth: sidebar?.width ?? 0,
              headerHeight: header?.height ?? 0,
              triggerVisible: trigger ? getComputedStyle(trigger).display !== 'none' : false,
              triggerRight: triggerBounds?.right ?? 0,
              titleLeft: title?.left ?? 0,
              titleRight: title?.right ?? 0,
              accountLeft: account?.left ?? 0,
              mainWidth: main?.width ?? 0,
              sectionColumns: new Set([...document.querySelectorAll('[data-dashboard-section]')].map((item) => item.getBoundingClientRect().left)).size,
            }
          })()`)
          assert.equal(shellLayout.width, 390)
          assert.equal(shellLayout.shellCount, 1)
          assert.equal(shellLayout.sidebarWidth, 0)
          assert.equal(shellLayout.headerHeight, 72)
          assert.equal(shellLayout.triggerVisible, true)
          assert.ok(shellLayout.triggerRight <= shellLayout.titleLeft)
          assert.ok(shellLayout.titleRight <= shellLayout.accountLeft)
          assert.ok(shellLayout.mainWidth > 0 && shellLayout.mainWidth <= 390)
          assert.equal(shellLayout.sectionColumns, 1)

          assert.equal(
            await client.evaluate(
              'document.querySelector(\'button[aria-label="Buka navigasi"]\')?.click(); true',
            ),
            true,
          )
          await client.waitFor(
            "Boolean(document.querySelector('[role=dialog]') && document.querySelector('[role=dialog] nav[aria-label=\"Navigasi utama\"]'))",
          )
          assert.equal(
            await client.evaluate(
              "document.activeElement?.closest('[role=dialog]') !== null",
            ),
            true,
          )
          await client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Escape',
            code: 'Escape',
          })
          await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Escape',
            code: 'Escape',
          })
          await client.waitFor("!document.querySelector('[role=dialog]')")
          assert.equal(
            await client.evaluate(
              "document.activeElement?.getAttribute('aria-label')",
            ),
            'Buka navigasi',
          )

          await client.evaluate(
            'document.querySelector(\'button[aria-label="Buka navigasi"]\')?.click(); true',
          )
          await client.waitFor(
            "Boolean(document.querySelector('[role=dialog]'))",
          )
          await client.evaluate(
            'document.querySelector(\'[role=dialog] [data-navigation-item="dashboard"]\')?.click(); true',
          )
          await client.waitFor("!document.querySelector('[role=dialog]')")

          await client.evaluate(
            'document.querySelector(\'button[aria-label="Buka navigasi"]\')?.click(); true',
          )
          await client.waitFor(
            "Boolean(document.querySelector('[role=dialog]'))",
          )
          await client.evaluate(
            'document.querySelector(\'button[aria-label="Tutup navigasi"]\')?.click(); true',
          )
          await client.waitFor("!document.querySelector('[role=dialog]')")

          await client.evaluate(
            'document.querySelector(\'button[aria-label="Buka navigasi"]\')?.click(); true',
          )
          await client.waitFor(
            "Boolean(document.querySelector('[role=dialog]'))",
          )
          await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1024,
            height: 768,
            deviceScaleFactor: 1,
            mobile: false,
          })
          await client.waitFor("!document.querySelector('[role=dialog]')")
          assert.equal(
            await client.evaluate(
              "document.querySelector('aside')?.getBoundingClientRect().width",
            ),
            240,
          )

          await client.evaluate(
            "document.querySelector('summary')?.click(); true",
          )
          assert.equal(await client.evaluate(clickButton('Keluar')), true)
          await client.waitFor("location.pathname === '/login'")
        },
      )
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
      await db.delete(user).where(inArray(user.email, temporaryEmails))
      await db.$client.end()
      await rm(profile, { recursive: true, force: true, maxRetries: 5 })
    }
  },
)
