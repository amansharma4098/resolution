/**
 * Similar-past-incident ranking — real, deterministic, and fully explainable (every match is
 * named in `matchedOn`), not a fake "AI-powered" label on a coin flip. This is the same
 * feature every incident-response competitor leads with (incident.io's Investigations,
 * Rootly's AI SRE, BigPanda's Incident Assistant all surface "we've seen this before, here's
 * what fixed it") — the honest version here is attribute + keyword overlap, upgradeable to
 * real vector/embedding search once the Knowledge base (Phase 7, `KnowledgeEmbedding`) ships,
 * without changing this function's callers.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "in", "on", "for", "to", "of", "and", "or",
  "with", "at", "by", "this", "that", "from", "has", "have", "had", "not", "but", "its",
]);

function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  );
}

export interface SimilarityAttributes {
  title: string;
  service: string | null;
  affectedSystem: string | null;
  source: string;
}

export interface SimilarityMatch {
  score: number;
  /** Every signal that contributed to the score, e.g. ["service", "keyword:disk"] — shown to
   *  the user/agent so "similar" is never an unexplained black box. */
  matchedOn: string[];
}

/** Weights are attribute-match-first, keyword-overlap-second — two incidents on the same
 *  service are a stronger signal than sharing two words in the title, but both count. */
export function scoreSimilarity(target: SimilarityAttributes, candidate: SimilarityAttributes): SimilarityMatch {
  let score = 0;
  const matchedOn: string[] = [];

  if (target.service && candidate.service && target.service === candidate.service) {
    score += 3;
    matchedOn.push("service");
  }
  if (target.affectedSystem && candidate.affectedSystem && target.affectedSystem === candidate.affectedSystem) {
    score += 2;
    matchedOn.push("affectedSystem");
  }
  if (target.source === candidate.source) {
    score += 1;
    matchedOn.push("source");
  }

  const targetTokens = tokenize(target.title);
  const candidateTokens = tokenize(candidate.title);
  const sharedTokens = [...targetTokens].filter((token) => candidateTokens.has(token));
  if (sharedTokens.length > 0) {
    score += sharedTokens.length * 2;
    matchedOn.push(...sharedTokens.map((token) => `keyword:${token}`));
  }

  return { score, matchedOn };
}

export interface RankedSimilarIncident<T> {
  incident: T;
  score: number;
  matchedOn: string[];
}

/** Ranks `candidates` against `target`, dropping anything scoring 0 (no signal in common at
 *  all — never surfaced as "similar" just because it's the most recent unrelated incident). */
export function rankSimilarIncidents<T extends SimilarityAttributes>(
  target: SimilarityAttributes,
  candidates: T[],
  limit: number,
): RankedSimilarIncident<T>[] {
  return candidates
    .map((incident) => ({ incident, ...scoreSimilarity(target, incident) }))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
