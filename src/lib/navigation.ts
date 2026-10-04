import type { PermissionCode } from './authorization-codes.ts'
import { PERMISSION_CODES } from './authorization-codes.ts'

export const NAVIGATION_GROUPS = [
  { id: 'main', label: 'Utama' },
  { id: 'operations', label: 'Operasional' },
  { id: 'insights', label: 'Insight' },
  { id: 'system', label: 'Sistem' },
] as const

export type NavigationGroupId = (typeof NAVIGATION_GROUPS)[number]['id']

type NavigationItemBase = {
  id: string
  label: string
  group: NavigationGroupId
} & (
  | { authenticatedOnly: true; requiredAnyPermission?: never }
  | {
      authenticatedOnly?: never
      requiredAnyPermission: readonly PermissionCode[]
    }
)

export type NavigationItem = NavigationItemBase &
  (
    | { availability: 'available'; href: '/' | '/members' }
    | { availability: 'planned'; plannedPath: string }
  )

export const NAVIGATION_REGISTRY = [
  {
    id: 'dashboard',
    label: 'Dasbor',
    group: 'main',
    availability: 'available',
    href: '/',
    authenticatedOnly: true,
  },
  {
    id: 'members',
    label: 'Anggota',
    group: 'operations',
    availability: 'available',
    href: '/members',
    requiredAnyPermission: [PERMISSION_CODES.MEMBER_READ],
  },
  {
    id: 'loans',
    label: 'Pengajuan Pinjaman',
    group: 'operations',
    availability: 'planned',
    plannedPath: '/loans',
    requiredAnyPermission: [
      PERMISSION_CODES.LOAN_CREATE,
      PERMISSION_CODES.LOAN_UPDATE_DRAFT,
      PERMISSION_CODES.LOAN_SUBMIT,
      PERMISSION_CODES.CREDIT_REVIEW_COMPLETE,
    ],
  },
  {
    id: 'approvals',
    label: 'Pusat Persetujuan',
    group: 'operations',
    availability: 'planned',
    plannedPath: '/approvals',
    requiredAnyPermission: [
      PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
      PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
    ],
  },
  {
    id: 'documents',
    label: 'Dokumen',
    group: 'operations',
    availability: 'planned',
    plannedPath: '/documents',
    requiredAnyPermission: [
      PERMISSION_CODES.DOCUMENT_UPLOAD,
      PERMISSION_CODES.DOCUMENT_VERIFY,
    ],
  },
  {
    id: 'reports',
    label: 'Laporan',
    group: 'insights',
    availability: 'planned',
    plannedPath: '/reports',
    requiredAnyPermission: [PERMISSION_CODES.REPORT_READ],
  },
  {
    id: 'users-access',
    label: 'Pengguna & Akses',
    group: 'system',
    availability: 'planned',
    plannedPath: '/admin/users',
    requiredAnyPermission: [PERMISSION_CODES.ADMIN_USER_ACCESS],
  },
  {
    id: 'activity',
    label: 'Aktivitas',
    group: 'system',
    availability: 'planned',
    plannedPath: '/activity',
    requiredAnyPermission: [PERMISSION_CODES.AUDIT_READ],
  },
  {
    id: 'integration-status',
    label: 'Status Integrasi',
    group: 'system',
    availability: 'planned',
    plannedPath: '/admin/integrations',
    requiredAnyPermission: [PERMISSION_CODES.INTEGRATION_READ],
  },
  {
    id: 'settings',
    label: 'Pengaturan',
    group: 'system',
    availability: 'planned',
    plannedPath: '/admin/settings',
    requiredAnyPermission: [PERMISSION_CODES.SETTINGS_MANAGE],
  },
] as const satisfies readonly NavigationItem[]

export const canSeeNavigationItem = (
  item: NavigationItem,
  permissions: readonly string[],
) => {
  if (item.authenticatedOnly) return true
  return item.requiredAnyPermission.some((permission) =>
    permissions.includes(permission),
  )
}

export const navigationItemsFor = (permissions: readonly string[]) =>
  NAVIGATION_REGISTRY.filter((item) => canSeeNavigationItem(item, permissions))

export const navigationGroupsFor = (permissions: readonly string[]) => {
  const items = navigationItemsFor(permissions)
  return NAVIGATION_GROUPS.flatMap((group) => {
    const groupItems = items.filter((item) => item.group === group.id)
    return groupItems.length > 0 ? [{ ...group, items: groupItems }] : []
  })
}

const normalizedPath = (path: string) =>
  path === '/' ? path : path.replace(/\/+$/, '')

export const isNavigationItemActive = (
  item: NavigationItem,
  pathname: string,
) => {
  const target =
    item.availability === 'available' ? item.href : item.plannedPath
  const current = normalizedPath(pathname)
  const normalizedTarget = normalizedPath(target)
  return normalizedTarget === '/'
    ? current === '/'
    : current === normalizedTarget || current.startsWith(`${normalizedTarget}/`)
}
