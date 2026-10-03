import type { ReactNode } from 'react'
import { useMatches } from '@tanstack/react-router'

export type AppHeaderContext = {
  title: string
  subtitle?: string
}

export const DEFAULT_APP_HEADER_CONTEXT: AppHeaderContext = {
  title: 'Ruang Kerja Digital',
  subtitle: 'Workspace internal Hanura',
}

export const resolveAppHeaderContext = (
  contexts: readonly (AppHeaderContext | undefined)[],
) => {
  for (let index = contexts.length - 1; index >= 0; index -= 1) {
    const context = contexts[index]
    if (context) return context
  }
  return DEFAULT_APP_HEADER_CONTEXT
}

export const useAppHeaderContext = () =>
  useMatches({
    select: (matches) =>
      resolveAppHeaderContext(
        matches.map(({ staticData }) => staticData.appHeader),
      ),
  })

export function AppHeader({
  account,
  context,
  navigation,
}: {
  account: ReactNode
  context: AppHeaderContext
  navigation?: ReactNode
}) {
  return (
    <header
      data-app-header="true"
      className="flex h-[72px] items-center justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 sm:px-7"
    >
      {navigation}
      <div className="min-w-0 flex-1" data-shell-header-slot="true">
        <h1 className="truncate text-xl leading-[29px] font-semibold">
          {context.title}
        </h1>
        {context.subtitle ? (
          <p className="truncate text-[11px] leading-4 text-[#64748b]">
            {context.subtitle}
          </p>
        ) : null}
      </div>
      <div className="shrink-0" data-shell-account-slot="true">
        {account}
      </div>
    </header>
  )
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    appHeader?: AppHeaderContext
  }
}
