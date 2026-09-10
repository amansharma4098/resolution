import { z } from "zod";

/**
 * Every RCA claim is typed as FACT / INFERENCE / HYPOTHESIS (spec §4) and — for FACT claims
 * — must cite at least one IncidentEvidence id. The API layer (Phase 7) rejects an RCA
 * response failing this constraint before it's persisted; this schema is the contract the
 * LLM's tool-call output is validated against, not documentation only.
 */
export const ClaimType = z.enum(["FACT", "INFERENCE", "HYPOTHESIS"]);
export type ClaimType = z.infer<typeof ClaimType>;

export const RcaClaim = z
  .object({
    text: z.string().min(1),
    claimType: ClaimType,
    evidenceIds: z.array(z.string().uuid()).default([]),
    confidence: z.number().min(0).max(1),
  })
  .refine((claim) => claim.claimType !== "FACT" || claim.evidenceIds.length > 0, {
    message: "FACT claims must cite at least one evidenceId — never invent evidence",
    path: ["evidenceIds"],
  });
export type RcaClaim = z.infer<typeof RcaClaim>;

export const RootCauseAnalysisOutput = z.object({
  summary: z.string().min(1),
  claims: z.array(RcaClaim).min(1),
  confidence: z.number().min(0).max(1),
  alternativeHypotheses: z.array(z.string()).default([]),
});
export type RootCauseAnalysisOutput = z.infer<typeof RootCauseAnalysisOutput>;
