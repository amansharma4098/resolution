-- Adds the pgvector column + index that Prisma cannot express natively.
-- See ARCHITECTURE.md §12 and schema.prisma KnowledgeEmbedding model comment.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "KnowledgeEmbedding" ADD COLUMN "embedding" vector(1536);

-- ivfflat requires an estimate of row count to size `lists`; 100 is a reasonable default
-- for early-stage data and should be tuned (ANALYZE + reindex) as each org's knowledge base grows.
CREATE INDEX "KnowledgeEmbedding_embedding_idx"
  ON "KnowledgeEmbedding"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
