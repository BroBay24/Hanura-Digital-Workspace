import assert from 'node:assert/strict'
import { count, eq, inArray } from 'drizzle-orm'
import { db } from './index.ts'
import type { loanApplicationStatus } from './schema.ts'
import {
  approvals,
  auditEvents,
  creditReviews,
  documents,
  documentVerificationEvents,
  documentVersions,
  integrationMappings,
  integrationSyncJobs,
  loanApplications,
  loanStatusHistory,
  memberCoreSnapshots,
  memberReferences,
  notifications,
  outboxEvents,
  permissions,
  rolePermissions,
  roles,
  user,
  userRoles,
  workspaceSettings,
} from './schema.ts'
import { serverEnv } from '#/env.server'

const databaseUrl = new URL(serverEnv.DATABASE_URL)

if (
  process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/hanura_workspace'
) {
  throw new Error('Seed is restricted to the local development database')
}

const stableUuid = (scope: number, index: number) =>
  `00000000-0000-4000-8${scope.toString(16).padStart(3, '0')}-${index
    .toString(16)
    .padStart(12, '0')}`

const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 0, day, hour))

const userIds = {
  chairman: 'demo-user-chairman',
  manager: 'demo-user-manager',
  creditOfficer: 'demo-user-credit-officer',
  teller: 'demo-user-teller',
  admin: 'demo-user-admin',
} as const

const usersData = [
  {
    id: userIds.chairman,
    name: 'Demo Ketua',
    email: 'ketua.demo@hanura.local',
    emailVerified: false,
    createdAt: at(1),
    updatedAt: at(1),
  },
  {
    id: userIds.manager,
    name: 'Demo Manager',
    email: 'manager.demo@hanura.local',
    emailVerified: false,
    createdAt: at(1),
    updatedAt: at(1),
  },
  {
    id: userIds.creditOfficer,
    name: 'Demo Petugas Kredit',
    email: 'kredit.demo@hanura.local',
    emailVerified: false,
    createdAt: at(1),
    updatedAt: at(1),
  },
  {
    id: userIds.teller,
    name: 'Demo Teller',
    email: 'teller.demo@hanura.local',
    emailVerified: false,
    createdAt: at(1),
    updatedAt: at(1),
  },
  {
    id: userIds.admin,
    name: 'Demo Administrator',
    email: 'admin.demo@hanura.local',
    emailVerified: false,
    createdAt: at(1),
    updatedAt: at(1),
  },
]

const roleCodes = [
  ['CHAIRMAN', 'Ketua / Pengurus'],
  ['MANAGER', 'Manajer'],
  ['CREDIT_OFFICER', 'Petugas Kredit'],
  ['TELLER', 'Teller / Staf'],
  ['ADMIN', 'Administrator'],
] as const

const rolesData = roleCodes.map(([code, name], index) => ({
  id: stableUuid(1, index + 1),
  code,
  name,
  description: `Role synthetic ${name}`,
  isSystem: true,
  createdAt: at(1),
  updatedAt: at(1),
}))

const permissionCodes = [
  'member.read',
  'loan.create',
  'loan.update_draft',
  'loan.submit',
  'document.upload',
  'document.verify',
  'credit_review.complete',
  'approval.manager.decide',
  'approval.chairman.decide',
  'admin.user_access',
  'audit.read',
  'integration.read',
  'settings.manage',
  'report.read',
] as const

const permissionsData = permissionCodes.map((code, index) => ({
  id: stableUuid(2, index + 1),
  code,
  description: `Izin synthetic untuk ${code}`,
  createdAt: at(1),
}))

const rolePermissionCodes: Record<(typeof roleCodes)[number][0], string[]> = {
  CHAIRMAN: ['member.read', 'approval.chairman.decide', 'report.read'],
  MANAGER: ['member.read', 'approval.manager.decide', 'report.read'],
  CREDIT_OFFICER: [
    'member.read',
    'loan.create',
    'loan.update_draft',
    'loan.submit',
    'document.upload',
    'document.verify',
    'credit_review.complete',
  ],
  TELLER: ['member.read'],
  ADMIN: [
    'admin.user_access',
    'audit.read',
    'integration.read',
    'settings.manage',
  ],
}

const roleByCode = Object.fromEntries(
  rolesData.map((role) => [role.code, role]),
) as Record<(typeof roleCodes)[number][0], (typeof rolesData)[number]>
const permissionByCode = Object.fromEntries(
  permissionsData.map((permission) => [permission.code, permission]),
) as Record<(typeof permissionCodes)[number], (typeof permissionsData)[number]>

const rolePermissionsData = Object.entries(rolePermissionCodes).flatMap(
  ([roleCode, codes]) =>
    codes.map((permissionCode) => ({
      roleId: roleByCode[roleCode as keyof typeof roleByCode].id,
      permissionId:
        permissionByCode[permissionCode as keyof typeof permissionByCode].id,
    })),
)

const userRolesData = [
  [userIds.chairman, 'CHAIRMAN'],
  [userIds.manager, 'MANAGER'],
  [userIds.creditOfficer, 'CREDIT_OFFICER'],
  [userIds.teller, 'TELLER'],
  [userIds.admin, 'ADMIN'],
].map(([userId, roleCode]) => ({
  userId,
  roleId: roleByCode[roleCode as keyof typeof roleByCode].id,
  assignedBy: userIds.admin,
  assignedAt: at(1, 10),
}))

const membersData = Array.from({ length: 10 }, (_, index) => ({
  id: stableUuid(3, index + 1),
  providerKey: 'mock',
  coreMemberId: `MOCK-MBR-${String(index + 1).padStart(3, '0')}`,
  displayNameCache: `Anggota Demo ${String(index + 1).padStart(3, '0')}`,
  statusCache: index === 9 ? 'INACTIVE' : 'ACTIVE',
  createdAt: at(2),
  updatedAt: at(2),
}))

const snapshotsData = membersData.slice(0, 8).map((member, index) => ({
  id: stableUuid(4, index + 1),
  memberReferenceId: member.id,
  providerKey: 'mock',
  payload: {
    synthetic: true,
    derivedReadModel: true,
    asOf: '2026-01-02T09:00:00.000Z',
    savingsSummary: { amount: 1_000_000 + index * 125_000 },
    loanSummary: { outstandingAmount: index % 3 === 0 ? 500_000 : 0 },
    recentTransactionSummary: { count: index + 1 },
  },
  fetchedAt: at(2, 9),
  expiresAt: index < 6 ? at(3, 9) : at(2, 10),
  freshnessStatus: index < 6 ? 'FRESH' : 'STALE',
  providerRequestId: `MOCK-REQ-${String(index + 1).padStart(3, '0')}`,
}))

const loanPaths = [
  ['DRAFT'],
  ['DRAFT', 'SUBMITTED'],
  ['DRAFT', 'SUBMITTED', 'DOCUMENT_VERIFICATION'],
  ['DRAFT', 'SUBMITTED', 'DOCUMENT_VERIFICATION', 'CREDIT_REVIEW'],
  [
    'DRAFT',
    'SUBMITTED',
    'DOCUMENT_VERIFICATION',
    'CREDIT_REVIEW',
    'MANAGER_APPROVAL',
  ],
  [
    'DRAFT',
    'SUBMITTED',
    'DOCUMENT_VERIFICATION',
    'CREDIT_REVIEW',
    'MANAGER_APPROVAL',
    'CHAIRMAN_APPROVAL',
  ],
  [
    'DRAFT',
    'SUBMITTED',
    'DOCUMENT_VERIFICATION',
    'CREDIT_REVIEW',
    'MANAGER_APPROVAL',
    'CHAIRMAN_APPROVAL',
    'APPROVED',
  ],
  [
    'DRAFT',
    'SUBMITTED',
    'DOCUMENT_VERIFICATION',
    'CREDIT_REVIEW',
    'MANAGER_APPROVAL',
    'CHAIRMAN_APPROVAL',
    'APPROVED',
    'READY_FOR_CORE_INTEGRATION',
  ],
  [
    'DRAFT',
    'SUBMITTED',
    'DOCUMENT_VERIFICATION',
    'CREDIT_REVIEW',
    'RETURNED_FOR_REVISION',
  ],
  ['DRAFT', 'SUBMITTED', 'DOCUMENT_VERIFICATION', 'CREDIT_REVIEW', 'REJECTED'],
] as const

type LoanStatus = (typeof loanApplicationStatus.enumValues)[number]

const actorForStatus = (status: LoanStatus) => {
  if (status === 'APPROVED' || status === 'READY_FOR_CORE_INTEGRATION') {
    return userIds.chairman
  }
  if (status === 'CHAIRMAN_APPROVAL') return userIds.manager
  return userIds.creditOfficer
}

const loansData = loanPaths.map((path, index) => {
  const statuses: readonly LoanStatus[] = path
  const status = statuses[statuses.length - 1]
  return {
    id: stableUuid(5, index + 1),
    applicationNo: `HDW-DEMO-LOAN-${String(index + 1).padStart(3, '0')}`,
    memberReferenceId: membersData[index].id,
    requestedAmount: `${(index + 1) * 2_500_000}.00`,
    termMonths: 6 + index * 3,
    purpose: `Keperluan synthetic demo ${String(index + 1).padStart(3, '0')}`,
    status,
    version: statuses.length,
    createdBy: userIds.creditOfficer,
    submittedAt: statuses.includes('SUBMITTED') ? at(index + 3, 10) : null,
    approvedAt: statuses.includes('APPROVED') ? at(index + 3, 15) : null,
    readyForCoreAt:
      status === 'READY_FOR_CORE_INTEGRATION' ? at(index + 3, 16) : null,
    createdAt: at(index + 3, 8),
    updatedAt: at(index + 3, 8 + path.length),
  }
})

const historiesData = loanPaths.flatMap((path, loanIndex) =>
  path.map((toStatus, step) => ({
    id: stableUuid(6, loanIndex * 20 + step + 1),
    loanApplicationId: loansData[loanIndex].id,
    fromStatus: step === 0 ? null : path[step - 1],
    toStatus,
    actorUserId: actorForStatus(toStatus),
    reason:
      toStatus === 'RETURNED_FOR_REVISION'
        ? 'Synthetic revision requested'
        : toStatus === 'REJECTED'
          ? 'Synthetic rejection scenario'
          : null,
    correlationId: `HDW-DEMO-CORR-${loanIndex + 1}`,
    createdAt: at(loanIndex + 3, 8 + step),
  })),
)

const reviewLoanIndexes = [3, 4, 5, 6, 7, 8, 9]
const reviewsData = reviewLoanIndexes.map((loanIndex, index) => {
  const status = loansData[loanIndex].status
  const completed = status !== 'CREDIT_REVIEW'
  return {
    id: stableUuid(7, index + 1),
    loanApplicationId: loansData[loanIndex].id,
    reviewerUserId: userIds.creditOfficer,
    recommendation:
      status === 'REJECTED'
        ? 'RECOMMEND_REJECTION'
        : status === 'RETURNED_FOR_REVISION'
          ? 'REQUEST_REVISION'
          : completed
            ? 'RECOMMEND_APPROVAL'
            : 'PENDING',
    note: `Catatan synthetic review ${index + 1}`,
    version: 1,
    completedAt: completed ? at(loanIndex + 3, 12) : null,
    createdAt: at(loanIndex + 3, 11),
    updatedAt: at(loanIndex + 3, completed ? 12 : 11),
  }
})

const documentsData = [
  ['REQUIRED', 0],
  ['UPLOADED', 1],
  ['VERIFIED', 2],
  ['REJECTED', 3],
  ['REUPLOAD_REQUIRED', 4],
].map(([status, loanIndex], index) => ({
  id: stableUuid(8, index + 1),
  memberReferenceId: membersData[Number(loanIndex)].id,
  loanApplicationId: loansData[Number(loanIndex)].id,
  documentType: index === 0 ? 'IDENTITY_CARD' : 'INCOME_PROOF',
  status: status as
    'REQUIRED' | 'UPLOADED' | 'VERIFIED' | 'REJECTED' | 'REUPLOAD_REQUIRED',
  createdAt: at(index + 4, 9),
  updatedAt: at(index + 4, 10),
}))

const versionsData = documentsData.slice(1).map((document, index) => ({
  id: stableUuid(9, index + 1),
  documentId: document.id,
  versionNo: 1,
  storageKey: `demo/loan-${String(index + 2).padStart(3, '0')}/document-v1.pdf`,
  originalName: `synthetic-document-${index + 1}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: BigInt(1024 * (index + 1)),
  checksum: `synthetic-checksum-${index + 1}`,
  uploadedBy: userIds.creditOfficer,
  uploadedAt: at(index + 5, 9),
}))

const verificationEventsData = [
  {
    id: stableUuid(10, 1),
    documentId: documentsData[2].id,
    documentVersionId: versionsData[1].id,
    action: 'VERIFIED' as const,
    actorUserId: userIds.creditOfficer,
    reason: null,
    createdAt: at(6, 11),
  },
  {
    id: stableUuid(10, 2),
    documentId: documentsData[3].id,
    documentVersionId: versionsData[2].id,
    action: 'REJECTED' as const,
    actorUserId: userIds.creditOfficer,
    reason: 'Synthetic document mismatch',
    createdAt: at(7, 11),
  },
  {
    id: stableUuid(10, 3),
    documentId: documentsData[4].id,
    documentVersionId: versionsData[3].id,
    action: 'REUPLOAD_REQUESTED' as const,
    actorUserId: userIds.creditOfficer,
    reason: 'Synthetic image quality issue',
    createdAt: at(8, 11),
  },
]

const approvalsData = [
  {
    id: stableUuid(11, 1),
    loanApplicationId: loansData[4].id,
    stage: 'MANAGER' as const,
    status: 'PENDING' as const,
    requiredPermission: 'approval.manager.decide',
    actorUserId: null,
    reason: null,
    decisionNote: null,
    decidedAt: null,
  },
  {
    id: stableUuid(11, 2),
    loanApplicationId: loansData[5].id,
    stage: 'MANAGER' as const,
    status: 'APPROVED' as const,
    requiredPermission: 'approval.manager.decide',
    actorUserId: userIds.manager,
    reason: null,
    decisionNote: 'Synthetic manager approval',
    decidedAt: at(8, 13),
  },
  {
    id: stableUuid(11, 3),
    loanApplicationId: loansData[5].id,
    stage: 'CHAIRMAN' as const,
    status: 'PENDING' as const,
    requiredPermission: 'approval.chairman.decide',
    actorUserId: null,
    reason: null,
    decisionNote: null,
    decidedAt: null,
  },
  {
    id: stableUuid(11, 4),
    loanApplicationId: loansData[6].id,
    stage: 'MANAGER' as const,
    status: 'APPROVED' as const,
    requiredPermission: 'approval.manager.decide',
    actorUserId: userIds.manager,
    reason: null,
    decisionNote: 'Synthetic manager approval',
    decidedAt: at(9, 13),
  },
  {
    id: stableUuid(11, 5),
    loanApplicationId: loansData[6].id,
    stage: 'CHAIRMAN' as const,
    status: 'APPROVED' as const,
    requiredPermission: 'approval.chairman.decide',
    actorUserId: userIds.chairman,
    reason: null,
    decisionNote: 'Synthetic chairman approval',
    decidedAt: at(9, 15),
  },
  {
    id: stableUuid(11, 6),
    loanApplicationId: loansData[8].id,
    stage: 'MANAGER' as const,
    status: 'RETURNED' as const,
    requiredPermission: 'approval.manager.decide',
    actorUserId: userIds.manager,
    reason: 'Synthetic revision required',
    decisionNote: 'Please revise synthetic documents',
    decidedAt: at(11, 13),
  },
  {
    id: stableUuid(11, 7),
    loanApplicationId: loansData[9].id,
    stage: 'MANAGER' as const,
    status: 'REJECTED' as const,
    requiredPermission: 'approval.manager.decide',
    actorUserId: userIds.manager,
    reason: 'Synthetic rejection scenario',
    decisionNote: 'Rejected for demo workflow coverage',
    decidedAt: at(12, 13),
  },
].map((approval, index) => ({
  ...approval,
  cycleNo: 1,
  version: 1,
  createdAt: at(index + 7, 12),
  updatedAt: approval.decidedAt ?? at(index + 7, 12),
}))

const notificationsData = [
  {
    recipientUserId: userIds.manager,
    type: 'APPROVAL_ASSIGNED',
    title: 'Pengajuan menunggu persetujuan',
    message: 'Synthetic approval telah ditugaskan.',
    objectType: 'loan_application',
    objectId: loansData[4].id,
    readAt: null,
  },
  {
    recipientUserId: userIds.creditOfficer,
    type: 'DOCUMENT_REUPLOAD_REQUESTED',
    title: 'Unggah ulang dokumen',
    message: 'Synthetic document memerlukan unggah ulang.',
    objectType: 'document',
    objectId: documentsData[4].id,
    readAt: null,
  },
  {
    recipientUserId: userIds.chairman,
    type: 'APPROVAL_ASSIGNED',
    title: 'Persetujuan ketua diperlukan',
    message: 'Synthetic chairman approval menunggu keputusan.',
    objectType: 'loan_application',
    objectId: loansData[5].id,
    readAt: null,
  },
  {
    recipientUserId: userIds.creditOfficer,
    type: 'WORKFLOW_ADVANCED',
    title: 'Workflow dilanjutkan',
    message: 'Synthetic loan masuk tahap persetujuan.',
    objectType: 'loan_application',
    objectId: loansData[6].id,
    readAt: at(10, 16),
  },
  {
    recipientUserId: userIds.admin,
    type: 'INTEGRATION_ATTENTION',
    title: 'Mock integration perlu perhatian',
    message: 'Synthetic retryable failure tersedia untuk demo.',
    objectType: 'integration_sync_job',
    objectId: stableUuid(15, 3),
    readAt: at(13, 10),
  },
].map((notification, index) => ({
  id: stableUuid(12, index + 1),
  ...notification,
  createdAt: at(index + 9, 9),
}))

const auditActions = [
  ['LOAN_CREATED', 'loan_application', loansData[0].id, userIds.creditOfficer],
  [
    'LOAN_SUBMITTED',
    'loan_application',
    loansData[1].id,
    userIds.creditOfficer,
  ],
  ['DOCUMENT_VERIFIED', 'document', documentsData[2].id, userIds.creditOfficer],
  [
    'CREDIT_REVIEW_COMPLETED',
    'loan_application',
    loansData[6].id,
    userIds.creditOfficer,
  ],
  ['MANAGER_APPROVED', 'loan_application', loansData[6].id, userIds.manager],
  ['CHAIRMAN_APPROVED', 'loan_application', loansData[6].id, userIds.chairman],
  ['LOAN_RETURNED', 'loan_application', loansData[8].id, userIds.manager],
  ['ROLE_ASSIGNED', 'user', userIds.teller, userIds.admin],
] as const

const auditData = auditActions.map(
  ([action, objectType, objectId, actorUserId], index) => ({
    id: stableUuid(13, index + 1),
    actorUserId,
    actorType: 'USER',
    action,
    objectType,

    objectId,
    outcome: 'SUCCESS',
    metadata: { synthetic: true, safe: true },
    correlationId: `HDW-DEMO-AUDIT-${index + 1}`,
    createdAt: at(index + 3, 17),
  }),
)

const mappingsData = membersData.slice(0, 3).map((member, index) => ({
  id: stableUuid(14, index + 1),
  providerKey: 'mock',
  internalType: 'member_reference',
  internalId: member.id,
  externalType: 'mock_member',
  externalId: member.coreMemberId,
  createdAt: at(2),
  updatedAt: at(2),
}))

const integrationJobsData = [
  {
    status: 'SUCCEEDED' as const,
    attemptNo: 1,
    completedAt: at(13, 10),
    errorCode: null,
    errorMessageSafe: null,
  },
  {
    status: 'FAILED' as const,
    attemptNo: 1,
    completedAt: at(13, 11),
    errorCode: 'MOCK_VALIDATION_FAILED',
    errorMessageSafe: 'Synthetic validation failure',
  },
  {
    status: 'RETRYABLE_FAILED' as const,
    attemptNo: 2,
    completedAt: at(13, 12),
    errorCode: 'MOCK_TEMPORARY_FAILURE',
    errorMessageSafe: 'Synthetic retryable failure',
  },
].map((job, index) => ({
  id: stableUuid(15, index + 1),
  providerKey: 'mock',
  jobType: 'MEMBER_SNAPSHOT_SYNC',
  objectType: 'member_reference',
  objectId: membersData[index].id,
  startedAt: at(13, 9 + index),
  correlationId: `HDW-DEMO-SYNC-${index + 1}`,
  ...job,
}))

const settingsData = [
  {
    key: 'demo.mode',
    value: { enabled: true, syntheticDataOnly: true },
  },
  {
    key: 'ui.pagination',
    value: { defaultPageSize: 20 },
  },
  {
    key: 'app.display',
    value: { workspaceName: 'Hanura Digital Workspace Demo' },
  },
].map((setting) => ({
  ...setting,
  updatedBy: userIds.admin,
  updatedAt: at(1),
}))

const outboxData = [
  {
    id: stableUuid(16, 1),
    eventType: 'DEMO_LOAN_APPROVED',
    aggregateType: 'loan_application',
    aggregateId: loansData[6].id,
    payload: { synthetic: true, sideEffectsDisabled: true },
    status: 'DEMO_HELD',
    attempts: 0,
    availableAt: at(30),
    processedAt: null,
    createdAt: at(9, 16),
  },
  {
    id: stableUuid(16, 2),
    eventType: 'DEMO_READY_FOR_CORE',
    aggregateType: 'loan_application',
    aggregateId: loansData[7].id,
    payload: { synthetic: true, sideEffectsDisabled: true },
    status: 'DEMO_HELD',
    attempts: 0,
    availableAt: at(30),
    processedAt: null,
    createdAt: at(10, 16),
  },
]

try {
  await db.transaction(async (tx) => {
    await tx.insert(user).values(usersData).onConflictDoNothing()
    await tx.insert(roles).values(rolesData).onConflictDoNothing()
    await tx.insert(permissions).values(permissionsData).onConflictDoNothing()
    await tx
      .insert(rolePermissions)
      .values(rolePermissionsData)
      .onConflictDoNothing()
    await tx.insert(userRoles).values(userRolesData).onConflictDoNothing()
    await tx.insert(memberReferences).values(membersData).onConflictDoNothing()
    await tx
      .insert(memberCoreSnapshots)
      .values(snapshotsData)
      .onConflictDoNothing()
    await tx.insert(loanApplications).values(loansData).onConflictDoNothing()
    await tx
      .insert(loanStatusHistory)
      .values(historiesData)
      .onConflictDoNothing()
    await tx.insert(creditReviews).values(reviewsData).onConflictDoNothing()
    await tx.insert(approvals).values(approvalsData).onConflictDoNothing()
    await tx.insert(documents).values(documentsData).onConflictDoNothing()
    await tx.insert(documentVersions).values(versionsData).onConflictDoNothing()

    for (const [index, version] of versionsData.entries()) {
      await tx
        .update(documents)
        .set({ currentVersionId: version.id, updatedAt: at(index + 5, 10) })
        .where(eq(documents.id, documentsData[index + 1].id))
    }

    await tx
      .insert(documentVerificationEvents)
      .values(verificationEventsData)
      .onConflictDoNothing()
    await tx
      .insert(integrationMappings)
      .values(mappingsData)
      .onConflictDoNothing()
    await tx
      .insert(integrationSyncJobs)
      .values(integrationJobsData)
      .onConflictDoNothing()
    await tx
      .insert(notifications)
      .values(notificationsData)
      .onConflictDoNothing()
    for (const event of auditData) {
      await tx
        .insert(auditEvents)
        .values(event)
        .onConflictDoUpdate({
          target: auditEvents.id,
          set: {
            actorUserId: event.actorUserId,
            actorType: event.actorType,
            action: event.action,
            objectType: event.objectType,
            objectId: event.objectId,
            outcome: event.outcome,
            metadata: event.metadata,
            correlationId: event.correlationId,
            createdAt: event.createdAt,
          },
        })
    }
    await tx
      .insert(workspaceSettings)
      .values(settingsData)
      .onConflictDoNothing()
    await tx.insert(outboxEvents).values(outboxData).onConflictDoNothing()

    const [seededRoles] = await tx
      .select({ value: count() })
      .from(roles)
      .where(
        inArray(
          roles.id,
          rolesData.map((role) => role.id),
        ),
      )
    const [seededUsers] = await tx
      .select({ value: count() })
      .from(user)
      .where(
        inArray(
          user.id,
          usersData.map((item) => item.id),
        ),
      )
    const [seededMembers] = await tx
      .select({ value: count() })
      .from(memberReferences)
      .where(
        inArray(
          memberReferences.id,
          membersData.map((member) => member.id),
        ),
      )
    const [seededLoans] = await tx
      .select({ value: count() })
      .from(loanApplications)
      .where(
        inArray(
          loanApplications.id,
          loansData.map((loan) => loan.id),
        ),
      )
    const [seededDocuments] = await tx
      .select({ value: count() })
      .from(documents)
      .where(
        inArray(
          documents.id,
          documentsData.map((document) => document.id),
        ),
      )

    assert.equal(Number(seededRoles.value), 5)
    assert.equal(Number(seededUsers.value), 5)
    assert.equal(Number(seededMembers.value), 10)
    assert.equal(Number(seededLoans.value), 10)
    assert.equal(Number(seededDocuments.value), 5)
  })

  console.log('Synthetic seed completed')
} finally {
  await db.$client.end()
}
