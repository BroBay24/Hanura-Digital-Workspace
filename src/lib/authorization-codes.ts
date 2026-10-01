export const ROLE_CODES = {
  ADMIN: 'ADMIN',
  CHAIRMAN: 'CHAIRMAN',
  CREDIT_OFFICER: 'CREDIT_OFFICER',
  MANAGER: 'MANAGER',
  TELLER: 'TELLER',
} as const

export const PERMISSION_CODES = {
  ADMIN_USER_ACCESS: 'admin.user_access',
  APPROVAL_CHAIRMAN_DECIDE: 'approval.chairman.decide',
  APPROVAL_MANAGER_DECIDE: 'approval.manager.decide',
  AUDIT_READ: 'audit.read',
  CREDIT_REVIEW_COMPLETE: 'credit_review.complete',
  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_VERIFY: 'document.verify',
  INTEGRATION_READ: 'integration.read',
  LOAN_CREATE: 'loan.create',
  LOAN_SUBMIT: 'loan.submit',
  LOAN_UPDATE_DRAFT: 'loan.update_draft',
  MEMBER_READ: 'member.read',
  REPORT_READ: 'report.read',
  SETTINGS_MANAGE: 'settings.manage',
} as const

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES]
export type PermissionCode =
  (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES]
