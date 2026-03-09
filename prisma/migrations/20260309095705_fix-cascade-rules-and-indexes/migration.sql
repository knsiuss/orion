-- Fix cascade rules for CausalEdge and HyperEdgeMembership
-- to prevent orphan rows when parent nodes are deleted.
-- Also adds composite indexes for graph traversal and pagination.

-- Drop existing FK constraints for CausalEdge (from / to)
ALTER TABLE "CausalEdge" DROP CONSTRAINT IF EXISTS "CausalEdge_fromId_fkey";
ALTER TABLE "CausalEdge" DROP CONSTRAINT IF EXISTS "CausalEdge_toId_fkey";

-- Re-add with ON DELETE CASCADE
ALTER TABLE "CausalEdge"
  ADD CONSTRAINT "CausalEdge_fromId_fkey"
  FOREIGN KEY ("fromId") REFERENCES "CausalNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CausalEdge"
  ADD CONSTRAINT "CausalEdge_toId_fkey"
  FOREIGN KEY ("toId") REFERENCES "CausalNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop existing FK constraints for HyperEdgeMembership
ALTER TABLE "HyperEdgeMembership" DROP CONSTRAINT IF EXISTS "HyperEdgeMembership_hyperEdgeId_fkey";
ALTER TABLE "HyperEdgeMembership" DROP CONSTRAINT IF EXISTS "HyperEdgeMembership_nodeId_fkey";

-- Re-add with ON DELETE CASCADE
ALTER TABLE "HyperEdgeMembership"
  ADD CONSTRAINT "HyperEdgeMembership_hyperEdgeId_fkey"
  FOREIGN KEY ("hyperEdgeId") REFERENCES "CausalNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HyperEdgeMembership"
  ADD CONSTRAINT "HyperEdgeMembership_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "CausalNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add composite indexes for graph traversal
CREATE INDEX IF NOT EXISTS "CausalEdge_userId_fromId_toId_idx"
  ON "CausalEdge"("userId", "fromId", "toId");

CREATE INDEX IF NOT EXISTS "KnowledgeEdge_userId_fromId_toId_idx"
  ON "KnowledgeEdge"("userId", "fromId", "toId");

-- Add composite index for DocumentChunk pagination
CREATE INDEX IF NOT EXISTS "DocumentChunk_userId_documentId_chunkIndex_idx"
  ON "DocumentChunk"("userId", "documentId", "chunkIndex");
