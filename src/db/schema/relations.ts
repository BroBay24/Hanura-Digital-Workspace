import { relations } from 'drizzle-orm'
import { approvals } from './approvals.ts'
import { account, session, user } from './auth.ts'
import { auditEvents } from './audit.ts'
import {
  documents,
  documentVerificationEvents,
  documentVersions,
} from './documents.ts'
import { creditReviews, loanApplications, loanStatusHistory } from './loans.ts'
import { memberCoreSnapshots, memberReferences } from './members.ts'
import { notifications } from './notifications.ts'
import { permissions, rolePermissions, roles, userRoles } from './rbac.ts'
import { workspaceSettings } from './settings.ts'

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  roleAssignments: many(userRoles, { relationName: 'userRoleAssignee' }),
  assignedRoleAssignments: many(userRoles, {
    relationName: 'userRoleAssigner',
  }),
  createdLoanApplications: many(loanApplications, {
    relationName: 'loanCreator',
  }),
  loanStatusActions: many(loanStatusHistory, {
    relationName: 'loanStatusActor',
  }),
  creditReviews: many(creditReviews, { relationName: 'creditReviewer' }),
  uploadedDocumentVersions: many(documentVersions, {
    relationName: 'documentUploader',
  }),
  documentVerificationEvents: many(documentVerificationEvents, {
    relationName: 'documentVerifier',
  }),
  approvalDecisions: many(approvals, { relationName: 'approvalActor' }),
  notifications: many(notifications),
  auditEvents: many(auditEvents),
  settingsUpdates: many(workspaceSettings),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
}))

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(user, {
    fields: [userRoles.userId],
    references: [user.id],
    relationName: 'userRoleAssignee',
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  assignedByUser: one(user, {
    fields: [userRoles.assignedBy],
    references: [user.id],
    relationName: 'userRoleAssigner',
  }),
}))

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolePermissions.roleId],
      references: [roles.id],
    }),
    permission: one(permissions, {
      fields: [rolePermissions.permissionId],
      references: [permissions.id],
    }),
  }),
)

export const memberReferencesRelations = relations(
  memberReferences,
  ({ many }) => ({
    snapshots: many(memberCoreSnapshots),
    loanApplications: many(loanApplications),
    documents: many(documents),
  }),
)

export const memberCoreSnapshotsRelations = relations(
  memberCoreSnapshots,
  ({ one }) => ({
    memberReference: one(memberReferences, {
      fields: [memberCoreSnapshots.memberReferenceId],
      references: [memberReferences.id],
    }),
  }),
)

export const loanApplicationsRelations = relations(
  loanApplications,
  ({ many, one }) => ({
    memberReference: one(memberReferences, {
      fields: [loanApplications.memberReferenceId],
      references: [memberReferences.id],
    }),
    createdByUser: one(user, {
      fields: [loanApplications.createdBy],
      references: [user.id],
      relationName: 'loanCreator',
    }),
    statusHistory: many(loanStatusHistory),
    creditReviews: many(creditReviews),
    documents: many(documents),
    approvals: many(approvals),
  }),
)

export const loanStatusHistoryRelations = relations(
  loanStatusHistory,
  ({ one }) => ({
    loanApplication: one(loanApplications, {
      fields: [loanStatusHistory.loanApplicationId],
      references: [loanApplications.id],
    }),
    actorUser: one(user, {
      fields: [loanStatusHistory.actorUserId],
      references: [user.id],
      relationName: 'loanStatusActor',
    }),
  }),
)

export const creditReviewsRelations = relations(creditReviews, ({ one }) => ({
  loanApplication: one(loanApplications, {
    fields: [creditReviews.loanApplicationId],
    references: [loanApplications.id],
  }),
  reviewerUser: one(user, {
    fields: [creditReviews.reviewerUserId],
    references: [user.id],
    relationName: 'creditReviewer',
  }),
}))

export const documentsRelations = relations(documents, ({ many, one }) => ({
  memberReference: one(memberReferences, {
    fields: [documents.memberReferenceId],
    references: [memberReferences.id],
  }),
  loanApplication: one(loanApplications, {
    fields: [documents.loanApplicationId],
    references: [loanApplications.id],
  }),
  currentVersion: one(documentVersions, {
    fields: [documents.currentVersionId],
    references: [documentVersions.id],
    relationName: 'currentDocumentVersion',
  }),
  versions: many(documentVersions, { relationName: 'documentVersions' }),
  verificationEvents: many(documentVerificationEvents),
}))

export const documentVersionsRelations = relations(
  documentVersions,
  ({ many, one }) => ({
    document: one(documents, {
      fields: [documentVersions.documentId],
      references: [documents.id],
      relationName: 'documentVersions',
    }),
    currentForDocuments: many(documents, {
      relationName: 'currentDocumentVersion',
    }),
    uploadedByUser: one(user, {
      fields: [documentVersions.uploadedBy],
      references: [user.id],
      relationName: 'documentUploader',
    }),
    verificationEvents: many(documentVerificationEvents),
  }),
)

export const documentVerificationEventsRelations = relations(
  documentVerificationEvents,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentVerificationEvents.documentId],
      references: [documents.id],
    }),
    documentVersion: one(documentVersions, {
      fields: [documentVerificationEvents.documentVersionId],
      references: [documentVersions.id],
    }),
    actorUser: one(user, {
      fields: [documentVerificationEvents.actorUserId],
      references: [user.id],
      relationName: 'documentVerifier',
    }),
  }),
)

export const approvalsRelations = relations(approvals, ({ one }) => ({
  loanApplication: one(loanApplications, {
    fields: [approvals.loanApplicationId],
    references: [loanApplications.id],
  }),
  actorUser: one(user, {
    fields: [approvals.actorUserId],
    references: [user.id],
    relationName: 'approvalActor',
  }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipientUser: one(user, {
    fields: [notifications.recipientUserId],
    references: [user.id],
  }),
}))

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  actorUser: one(user, {
    fields: [auditEvents.actorUserId],
    references: [user.id],
  }),
}))

export const workspaceSettingsRelations = relations(
  workspaceSettings,
  ({ one }) => ({
    updatedByUser: one(user, {
      fields: [workspaceSettings.updatedBy],
      references: [user.id],
    }),
  }),
)
