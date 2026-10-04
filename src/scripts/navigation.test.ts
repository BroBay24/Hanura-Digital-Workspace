import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PERMISSION_CODES } from '#/lib/authorization-codes'
import {
  NAVIGATION_REGISTRY,
  canSeeNavigationItem,
  isNavigationItemActive,
  navigationGroupsFor,
  navigationItemsFor,
} from '#/lib/navigation'

const visibleIds = (permissions: readonly string[]) =>
  navigationItemsFor(permissions).map(({ id }) => id)

const rolePermissions = {
  CHAIRMAN: [
    PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
    PERMISSION_CODES.MEMBER_READ,
    PERMISSION_CODES.REPORT_READ,
  ],
  MANAGER: [
    PERMISSION_CODES.APPROVAL_MANAGER_DECIDE,
    PERMISSION_CODES.MEMBER_READ,
    PERMISSION_CODES.REPORT_READ,
  ],
  CREDIT_OFFICER: [
    PERMISSION_CODES.CREDIT_REVIEW_COMPLETE,
    PERMISSION_CODES.DOCUMENT_UPLOAD,
    PERMISSION_CODES.DOCUMENT_VERIFY,
    PERMISSION_CODES.LOAN_CREATE,
    PERMISSION_CODES.LOAN_SUBMIT,
    PERMISSION_CODES.LOAN_UPDATE_DRAFT,
    PERMISSION_CODES.MEMBER_READ,
  ],
  TELLER: [PERMISSION_CODES.MEMBER_READ],
  ADMIN: [
    PERMISSION_CODES.ADMIN_USER_ACCESS,
    PERMISSION_CODES.AUDIT_READ,
    PERMISSION_CODES.INTEGRATION_READ,
    PERMISSION_CODES.SETTINGS_MANAGE,
  ],
} as const

test('navigation registry is unique, permission-valid, and route-safe', () => {
  const ids = NAVIGATION_REGISTRY.map(({ id }) => id)
  assert.equal(new Set(ids).size, ids.length)

  const targets = NAVIGATION_REGISTRY.map((item) =>
    item.availability === 'available' ? item.href : item.plannedPath,
  )
  assert.equal(new Set(targets).size, targets.length)

  const permissionCatalog = new Set(Object.values(PERMISSION_CODES))
  for (const item of NAVIGATION_REGISTRY) {
    if ('requiredAnyPermission' in item) {
      for (const permission of item.requiredAnyPermission) {
        assert.equal(permissionCatalog.has(permission), true)
      }
    }
  }

  assert.deepEqual(
    NAVIGATION_REGISTRY.flatMap((item) =>
      item.availability === 'available'
        ? [{ id: item.id, href: item.href }]
        : [],
    ),
    [
      { id: 'dashboard', href: '/' },
      { id: 'members', href: '/members' },
    ],
  )
  assert.ok(
    NAVIGATION_REGISTRY.some(({ availability }) => availability === 'planned'),
  )
})

test('navigation presentation follows the five-role permission matrix', () => {
  assert.deepEqual(visibleIds(rolePermissions.CHAIRMAN), [
    'dashboard',
    'members',
    'approvals',
    'reports',
  ])
  assert.deepEqual(visibleIds(rolePermissions.MANAGER), [
    'dashboard',
    'members',
    'approvals',
    'reports',
  ])
  assert.deepEqual(visibleIds(rolePermissions.CREDIT_OFFICER), [
    'dashboard',
    'members',
    'loans',
    'documents',
  ])
  assert.deepEqual(visibleIds(rolePermissions.TELLER), ['dashboard', 'members'])
  assert.deepEqual(visibleIds(rolePermissions.ADMIN), [
    'dashboard',
    'users-access',
    'activity',
    'integration-status',
    'settings',
  ])
})

test('missing-role and unknown permissions stay at authenticated-only navigation', () => {
  assert.deepEqual(visibleIds([]), ['dashboard'])
  assert.deepEqual(visibleIds(['role=ADMIN', '*', 'unknown.permission']), [
    'dashboard',
  ])
})

test('multi-role permission union and any-permission predicates are deterministic', () => {
  const union = [...rolePermissions.CHAIRMAN, ...rolePermissions.CREDIT_OFFICER]
  assert.deepEqual(visibleIds(union), [
    'dashboard',
    'members',
    'loans',
    'approvals',
    'documents',
    'reports',
  ])

  const approvals = NAVIGATION_REGISTRY.find(({ id }) => id === 'approvals')
  assert.ok(approvals)
  assert.equal(
    canSeeNavigationItem(approvals, [PERMISSION_CODES.APPROVAL_MANAGER_DECIDE]),
    true,
  )
  assert.equal(
    canSeeNavigationItem(approvals, [
      PERMISSION_CODES.APPROVAL_CHAIRMAN_DECIDE,
    ]),
    true,
  )
})

test('navigation active state supports exact and nested paths', () => {
  const dashboard = NAVIGATION_REGISTRY.find(({ id }) => id === 'dashboard')
  const members = NAVIGATION_REGISTRY.find(({ id }) => id === 'members')
  assert.ok(dashboard)
  assert.ok(members)

  assert.equal(isNavigationItemActive(dashboard, '/'), true)
  assert.equal(isNavigationItemActive(dashboard, '/members'), false)
  assert.equal(isNavigationItemActive(members, '/members'), true)
  assert.equal(isNavigationItemActive(members, '/members/member-1'), true)
  assert.equal(isNavigationItemActive(members, '/reports'), false)
})

test('empty groups are omitted', () => {
  const groups = navigationGroupsFor([])
  assert.deepEqual(
    groups.map(({ id }) => id),
    ['main'],
  )
  assert.deepEqual(
    groups[0]?.items.map(({ id }) => id),
    ['dashboard'],
  )
})
