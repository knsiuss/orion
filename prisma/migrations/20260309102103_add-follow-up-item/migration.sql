-- Add FollowUpItem table for durable follow-up tracking (comm-intel module).
-- Replaces the in-memory-only fallback with a proper persisted model.

CREATE TABLE "FollowUpItem" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "message"     TEXT NOT NULL,
    "dueAt"       TIMESTAMP(3),
    "priority"    TEXT NOT NULL DEFAULT 'medium',
    "completed"   BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE INDEX "FollowUpItem_userId_completed_idx" ON "FollowUpItem"("userId", "completed");
CREATE INDEX "FollowUpItem_userId_dueAt_idx" ON "FollowUpItem"("userId", "dueAt");
