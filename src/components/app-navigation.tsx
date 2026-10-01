import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { isNavigationItemActive, navigationGroupsFor } from '#/lib/navigation'

const itemClassName =
  'flex min-h-[37px] w-full items-center rounded-[10px] px-3 py-[9px] text-left text-[11px] leading-[19px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

export function AppNavigation({
  label,
  onNavigate,
  permissions,
}: {
  label: string
  onNavigate?: () => void
  permissions: readonly string[]
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const groups = navigationGroupsFor(permissions)

  return (
    <nav
      aria-label={label}
      data-app-navigation="true"
      className="flex flex-col gap-[10px]"
    >
      {groups.map((group) => (
        <div key={group.id} data-navigation-group={group.id}>
          <p className="sr-only">{group.label}</p>
          <ul className="flex flex-col gap-[10px]">
            {group.items.map((item) => {
              const active = isNavigationItemActive(item, pathname)
              return (
                <li key={item.id}>
                  {item.availability === 'available' ? (
                    <Link
                      to={item.href}
                      activeOptions={{ exact: true }}
                      aria-current={active ? 'page' : undefined}
                      data-navigation-item={item.id}
                      onClick={onNavigate}
                      style={{
                        color: active ? '#ffffff' : 'rgba(255, 255, 255, 0.72)',
                      }}
                      className={`${itemClassName} ${
                        active
                          ? 'bg-[#2563eb] text-white'
                          : 'text-white/72 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      data-navigation-item={item.id}
                      data-availability="planned"
                      className={`${itemClassName} cursor-not-allowed text-white/45`}
                      title="Fitur belum tersedia"
                    >
                      <span>{item.label}</span>
                      <span className="sr-only"> — belum tersedia</span>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function NarrowNavigation({
  permissions,
}: {
  permissions: readonly string[]
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)')
    const closeOnDesktop = ({ matches }: MediaQueryListEvent) => {
      if (matches) setOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Buka navigasi"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e2e8f0] text-[#0f172a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] lg:hidden"
        >
          <Menu aria-hidden="true" className="h-4 w-4" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0f172a]/55" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(320px,86vw)] overflow-y-auto bg-[#0f172a] px-5 py-7 text-white shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl leading-[29px] font-semibold">
                HANURA
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-[11px] leading-4 text-white/70">
                Ruang Kerja Digital
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Tutup navigasi"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-8">
            <AppNavigation
              label="Navigasi utama"
              permissions={permissions}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
