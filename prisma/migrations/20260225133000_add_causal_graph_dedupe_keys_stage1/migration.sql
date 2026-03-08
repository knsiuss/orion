-- Stage 1 (non-breaking): add nullable dedupe keys + indexes for causal graph cleanup.
-- Backfill and unique constraints are handled in follow-up steps (see docs/migrations/causal-graph-dedupe-plan.md).

ALTER TABLE "CausalNode" ADD COLUMN "eventKey" TEXT;

ALTER TABLE "HyperEdge" ADD COLUMN "memberSetHash" TEXT;

CREATE INDEX "CausalNode_userId_eventKey_idx" ON "CausalNode"("userId", "eventKey");

CREATE INDEX "HyperEdge_userId_relation_memberSetHash_idx"
ON "HyperEdge"("userId", "relation", "memberSetHash");
