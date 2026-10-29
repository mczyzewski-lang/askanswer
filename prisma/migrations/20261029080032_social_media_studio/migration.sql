-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'APPROVER', 'VIEWER');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'YOUTUBE', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'SCHEDULING', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'SCHEDULING_FAILED', 'PUBLISH_FAILED', 'CANCELLED', 'REAUTH_REQUIRED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ProviderJobStatus" AS ENUM ('SCHEDULING', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLING', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SocialMediaStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('NEW', 'NEEDS_REPLY', 'REPLIED', 'IGNORED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ReplyStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENDING', 'SENT', 'FAILED', 'REJECTED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'MEMBER';

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Warsaw',
    "language" TEXT NOT NULL DEFAULT 'pl',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandSettings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "products" TEXT NOT NULL DEFAULT '',
    "usp" TEXT NOT NULL DEFAULT '',
    "preferredCta" TEXT NOT NULL DEFAULT '',
    "forbiddenPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "knowledgeBase" TEXT NOT NULL DEFAULT '',
    "moderationRules" TEXT NOT NULL DEFAULT '',
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoReplyMaxPerHour" INTEGER NOT NULL DEFAULT 5,
    "commentRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderProfile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'upload-post',
    "username" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "platformAccountId" TEXT,
    "accountHandle" TEXT,
    "displayName" TEXT,
    "profileImage" TEXT,
    "connectionStatus" "AccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "capabilities" JSONB,
    "reauthRequired" BOOLEAN NOT NULL DEFAULT false,
    "pageId" TEXT,
    "pageName" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMedia" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "originalName" TEXT NOT NULL DEFAULT '',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'video/mp4',
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "sourceUrl" TEXT,
    "status" "SocialMediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "error" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "bitrate" INTEGER,
    "thumbnailKey" TEXT,
    "checks" JSONB,
    "transcript" TEXT,
    "transcriptStatus" TEXT,
    "importedFrom" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMediaVariant" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT,
    "status" "SocialMediaStatus" NOT NULL DEFAULT 'PROCESSING',
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMediaVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPost" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta" TEXT NOT NULL DEFAULT '',
    "firstComment" TEXT NOT NULL DEFAULT '',
    "coverTimestamp" DOUBLE PRECISION,
    "options" JSONB NOT NULL DEFAULT '{}',
    "mediaVariantId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "approvedRevision" INTEGER,
    "approvedHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "publishedUrl" TEXT,
    "platformPostId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "warnings" JSONB,
    "nextMetricsAt" TIMESTAMP(3),
    "nextCommentsAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRevision" (
    "id" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "editedById" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledPublication" (
    "id" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "providerProfileUsername" TEXT NOT NULL,
    "providerJobId" TEXT,
    "providerRequestId" TEXT,
    "externalId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ProviderJobStatus" NOT NULL DEFAULT 'SCHEDULING',
    "approvalId" TEXT,
    "contentHash" TEXT NOT NULL,
    "publishedUrl" TEXT,
    "platformPostId_native" TEXT,
    "errorMessage" TEXT,
    "warnings" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationAttempt" (
    "id" TEXT NOT NULL,
    "scheduledPublicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "httpStatus" INTEGER,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "request" JSONB,
    "response" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platformPostId" TEXT,
    "socialAccountId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "watchTimeSec" DOUBLE PRECISION,
    "avgViewDurationSec" DOUBLE PRECISION,
    "engagementRate" DOUBLE PRECISION,
    "followers" INTEGER,
    "unsupported" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialComment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platformPostId" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "nativeId" TEXT NOT NULL,
    "parentNativeId" TEXT,
    "authorName" TEXT NOT NULL DEFAULT '',
    "authorHandle" TEXT,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "likeCount" INTEGER,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'NEW',
    "category" TEXT,
    "sentiment" TEXT,
    "isQuestion" BOOLEAN NOT NULL DEFAULT false,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "aiReason" TEXT,
    "classifiedAt" TIMESTAMP(3),
    "isOwn" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentReply" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ReplyStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "aiGenerationId" TEXT,
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "nativeId" TEXT,
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommentReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentItemId" TEXT,
    "platformPostId" TEXT,
    "commentId" TEXT,
    "model" TEXT NOT NULL DEFAULT '',
    "rulesVersion" TEXT NOT NULL DEFAULT '',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "projectId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'upload-post',
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT '',
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "rawBody" TEXT NOT NULL,
    "headers" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "projectId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "organizationId" TEXT,
    "projectId" TEXT,
    "role" "OrgRole" NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoProviderRecord" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoProviderRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialProject_organizationId_slug_key" ON "SocialProject"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "SocialProjectMember_userId_idx" ON "SocialProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialProjectMember_projectId_userId_key" ON "SocialProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSettings_projectId_key" ON "BrandSettings"("projectId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_projectId_idx" ON "KnowledgeDoc"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_username_key" ON "ProviderProfile"("username");

-- CreateIndex
CREATE INDEX "ProviderProfile_projectId_idx" ON "ProviderProfile"("projectId");

-- CreateIndex
CREATE INDEX "SocialAccount_projectId_idx" ON "SocialAccount"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_providerProfileId_platform_key" ON "SocialAccount"("providerProfileId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMedia_storageKey_key" ON "SocialMedia"("storageKey");

-- CreateIndex
CREATE INDEX "SocialMedia_projectId_createdAt_idx" ON "SocialMedia"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMediaVariant_storageKey_key" ON "SocialMediaVariant"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMediaVariant_mediaId_kind_key" ON "SocialMediaVariant"("mediaId", "kind");

-- CreateIndex
CREATE INDEX "ContentItem_projectId_createdAt_idx" ON "ContentItem"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformPost_projectId_status_idx" ON "PlatformPost"("projectId", "status");

-- CreateIndex
CREATE INDEX "PlatformPost_scheduledAt_idx" ON "PlatformPost"("scheduledAt");

-- CreateIndex
CREATE INDEX "PlatformPost_nextMetricsAt_idx" ON "PlatformPost"("nextMetricsAt");

-- CreateIndex
CREATE INDEX "PlatformPost_nextCommentsAt_idx" ON "PlatformPost"("nextCommentsAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPost_contentItemId_socialAccountId_key" ON "PlatformPost"("contentItemId", "socialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRevision_platformPostId_revision_key" ON "ContentRevision"("platformPostId", "revision");

-- CreateIndex
CREATE INDEX "Approval_platformPostId_createdAt_idx" ON "Approval"("platformPostId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledPublication_providerJobId_key" ON "ScheduledPublication"("providerJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledPublication_providerRequestId_key" ON "ScheduledPublication"("providerRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledPublication_externalId_key" ON "ScheduledPublication"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledPublication_idempotencyKey_key" ON "ScheduledPublication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScheduledPublication_status_idx" ON "ScheduledPublication"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledPublication_platformPostId_generation_key" ON "ScheduledPublication"("platformPostId", "generation");

-- CreateIndex
CREATE INDEX "PublicationAttempt_scheduledPublicationId_createdAt_idx" ON "PublicationAttempt"("scheduledPublicationId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_platformPostId_capturedAt_idx" ON "AnalyticsSnapshot"("platformPostId", "capturedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_projectId_capturedAt_idx" ON "AnalyticsSnapshot"("projectId", "capturedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_socialAccountId_capturedAt_idx" ON "AnalyticsSnapshot"("socialAccountId", "capturedAt");

-- CreateIndex
CREATE INDEX "SocialComment_projectId_status_postedAt_idx" ON "SocialComment"("projectId", "status", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialComment_socialAccountId_nativeId_key" ON "SocialComment"("socialAccountId", "nativeId");

-- CreateIndex
CREATE UNIQUE INDEX "CommentReply_idempotencyKey_key" ON "CommentReply"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommentReply_commentId_idx" ON "CommentReply"("commentId");

-- CreateIndex
CREATE INDEX "AiGeneration_projectId_kind_createdAt_idx" ON "AiGeneration"("projectId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AiGeneration_platformPostId_createdAt_idx" ON "AiGeneration"("platformPostId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_deliveryId_key" ON "WebhookEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserInvite_tokenHash_key" ON "UserInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "UserInvite_email_idx" ON "UserInvite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DemoProviderRecord_key_key" ON "DemoProviderRecord"("key");

-- CreateIndex
CREATE INDEX "DemoProviderRecord_kind_idx" ON "DemoProviderRecord"("kind");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialProject" ADD CONSTRAINT "SocialProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialProjectMember" ADD CONSTRAINT "SocialProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialProjectMember" ADD CONSTRAINT "SocialProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSettings" ADD CONSTRAINT "BrandSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDoc" ADD CONSTRAINT "KnowledgeDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMedia" ADD CONSTRAINT "SocialMedia_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMediaVariant" ADD CONSTRAINT "SocialMediaVariant_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "SocialMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "SocialMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPost" ADD CONSTRAINT "PlatformPost_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPost" ADD CONSTRAINT "PlatformPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPost" ADD CONSTRAINT "PlatformPost_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_platformPostId_fkey" FOREIGN KEY ("platformPostId") REFERENCES "PlatformPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_platformPostId_fkey" FOREIGN KEY ("platformPostId") REFERENCES "PlatformPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPublication" ADD CONSTRAINT "ScheduledPublication_platformPostId_fkey" FOREIGN KEY ("platformPostId") REFERENCES "PlatformPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_scheduledPublicationId_fkey" FOREIGN KEY ("scheduledPublicationId") REFERENCES "ScheduledPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_platformPostId_fkey" FOREIGN KEY ("platformPostId") REFERENCES "PlatformPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_platformPostId_fkey" FOREIGN KEY ("platformPostId") REFERENCES "PlatformPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentReply" ADD CONSTRAINT "CommentReply_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "SocialComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_platformPostId_fkey" FOREIGN KEY ("platformPostId") REFERENCES "PlatformPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
