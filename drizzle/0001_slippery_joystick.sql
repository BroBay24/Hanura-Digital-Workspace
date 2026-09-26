CREATE TYPE "public"."approval_stage" AS ENUM('MANAGER', 'CHAIRMAN');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'RETURNED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('REQUIRED', 'UPLOADED', 'VERIFIED', 'REJECTED', 'REUPLOAD_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."document_verification_action" AS ENUM('VERIFIED', 'REJECTED', 'REUPLOAD_REQUESTED');--> statement-breakpoint
CREATE TYPE "public"."integration_sync_job_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYABLE_FAILED');--> statement-breakpoint
CREATE TYPE "public"."loan_application_status" AS ENUM('DRAFT', 'SUBMITTED', 'DOCUMENT_VERIFICATION', 'CREDIT_REVIEW', 'MANAGER_APPROVAL', 'CHAIRMAN_APPROVAL', 'APPROVED', 'READY_FOR_CORE_INTEGRATION', 'RETURNED_FOR_REVISION', 'REJECTED');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_application_id" uuid NOT NULL,
	"stage" "approval_stage" NOT NULL,
	"cycle_no" integer DEFAULT 1 NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"required_permission" varchar(150) NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"decision_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_application_stage_cycle_unique" UNIQUE("loan_application_id","stage","cycle_no"),
	CONSTRAINT "approvals_cycle_positive" CHECK ("approvals"."cycle_no" > 0),
	CONSTRAINT "approvals_version_positive" CHECK ("approvals"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"actor_type" varchar(50) NOT NULL,
	"action" varchar(150) NOT NULL,
	"object_type" varchar(100) NOT NULL,
	"object_id" text NOT NULL,
	"outcome" varchar(50) NOT NULL,
	"metadata" jsonb,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid,
	"action" "document_verification_action" NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_document_version_unique" UNIQUE("document_id","version_no"),
	CONSTRAINT "document_versions_document_id_id_unique" UNIQUE("document_id","id"),
	CONSTRAINT "document_versions_version_positive" CHECK ("document_versions"."version_no" > 0),
	CONSTRAINT "document_versions_size_nonnegative" CHECK ("document_versions"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_reference_id" uuid,
	"loan_application_id" uuid,
	"document_type" varchar(100) NOT NULL,
	"status" "document_status" DEFAULT 'REQUIRED' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" varchar(100) NOT NULL,
	"internal_type" varchar(100) NOT NULL,
	"internal_id" uuid NOT NULL,
	"external_type" varchar(100) NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_mappings_provider_external_unique" UNIQUE("provider_key","external_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "integration_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" varchar(100) NOT NULL,
	"job_type" varchar(100) NOT NULL,
	"status" "integration_sync_job_status" DEFAULT 'PENDING' NOT NULL,
	"object_type" varchar(100),
	"object_id" uuid,
	"attempt_no" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" varchar(100),
	"error_message_safe" text,
	"correlation_id" text,
	CONSTRAINT "integration_sync_jobs_attempt_nonnegative" CHECK ("integration_sync_jobs"."attempt_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_application_id" uuid NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"recommendation" varchar(100) NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_reviews_application_unique" UNIQUE("loan_application_id"),
	CONSTRAINT "credit_reviews_version_positive" CHECK ("credit_reviews"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "loan_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_no" varchar(64) NOT NULL,
	"member_reference_id" uuid NOT NULL,
	"requested_amount" numeric(18, 2) NOT NULL,
	"term_months" integer NOT NULL,
	"purpose" text NOT NULL,
	"status" "loan_application_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"ready_for_core_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_applications_application_no_unique" UNIQUE("application_no"),
	CONSTRAINT "loan_applications_amount_positive" CHECK ("loan_applications"."requested_amount" > 0),
	CONSTRAINT "loan_applications_term_positive" CHECK ("loan_applications"."term_months" > 0),
	CONSTRAINT "loan_applications_version_positive" CHECK ("loan_applications"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "loan_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_application_id" uuid NOT NULL,
	"from_status" "loan_application_status",
	"to_status" "loan_application_status" NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_core_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_reference_id" uuid NOT NULL,
	"provider_key" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"freshness_status" varchar(50) NOT NULL,
	"provider_request_id" text
);
--> statement-breakpoint
CREATE TABLE "member_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" varchar(100) NOT NULL,
	"core_member_id" varchar(255) NOT NULL,
	"display_name_cache" text,
	"status_cache" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_references_provider_core_unique" UNIQUE("provider_key","core_member_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" varchar(100) NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"object_type" varchar(100),
	"object_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(150) NOT NULL,
	"aggregate_type" varchar(100) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(50) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_attempts_nonnegative" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(150) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"key" varchar(150) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_loan_application_id_loan_applications_id_fk" FOREIGN KEY ("loan_application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_verification_events" ADD CONSTRAINT "document_verification_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_verification_events" ADD CONSTRAINT "document_verification_events_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_verification_events" ADD CONSTRAINT "document_verification_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_member_reference_id_member_references_id_fk" FOREIGN KEY ("member_reference_id") REFERENCES "public"."member_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_loan_application_id_loan_applications_id_fk" FOREIGN KEY ("loan_application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_same_document_fk" FOREIGN KEY ("id","current_version_id") REFERENCES "public"."document_versions"("document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_reviews" ADD CONSTRAINT "credit_reviews_loan_application_id_loan_applications_id_fk" FOREIGN KEY ("loan_application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_reviews" ADD CONSTRAINT "credit_reviews_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_member_reference_id_member_references_id_fk" FOREIGN KEY ("member_reference_id") REFERENCES "public"."member_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_status_history" ADD CONSTRAINT "loan_status_history_loan_application_id_loan_applications_id_fk" FOREIGN KEY ("loan_application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_status_history" ADD CONSTRAINT "loan_status_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_core_snapshots" ADD CONSTRAINT "member_core_snapshots_member_reference_id_member_references_id_fk" FOREIGN KEY ("member_reference_id") REFERENCES "public"."member_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_actor_idx" ON "approvals" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "approvals_status_stage_created_idx" ON "approvals" USING btree ("status","stage","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_object_created_idx" ON "audit_events" USING btree ("object_type","object_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_created_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_correlation_idx" ON "audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "document_verification_events_document_created_idx" ON "document_verification_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "document_verification_events_version_idx" ON "document_verification_events" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "document_verification_events_actor_idx" ON "document_verification_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "document_versions_uploaded_by_idx" ON "document_versions" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "documents_member_type_idx" ON "documents" USING btree ("member_reference_id","document_type");--> statement-breakpoint
CREATE INDEX "documents_loan_status_idx" ON "documents" USING btree ("loan_application_id","status");--> statement-breakpoint
CREATE INDEX "documents_current_version_idx" ON "documents" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "integration_mappings_internal_idx" ON "integration_mappings" USING btree ("internal_type","internal_id");--> statement-breakpoint
CREATE INDEX "integration_sync_jobs_provider_status_started_idx" ON "integration_sync_jobs" USING btree ("provider_key","status","started_at");--> statement-breakpoint
CREATE INDEX "integration_sync_jobs_object_idx" ON "integration_sync_jobs" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "integration_sync_jobs_correlation_idx" ON "integration_sync_jobs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "credit_reviews_reviewer_idx" ON "credit_reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "loan_applications_member_updated_idx" ON "loan_applications" USING btree ("member_reference_id","updated_at");--> statement-breakpoint
CREATE INDEX "loan_applications_status_updated_idx" ON "loan_applications" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "loan_applications_created_by_idx" ON "loan_applications" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "loan_status_history_application_created_idx" ON "loan_status_history" USING btree ("loan_application_id","created_at");--> statement-breakpoint
CREATE INDEX "loan_status_history_actor_idx" ON "loan_status_history" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "member_core_snapshots_member_fetched_idx" ON "member_core_snapshots" USING btree ("member_reference_id","fetched_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_read_created_idx" ON "notifications" USING btree ("recipient_user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_status_available_idx" ON "outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_id_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_roles_assigned_by_idx" ON "user_roles" USING btree ("assigned_by");