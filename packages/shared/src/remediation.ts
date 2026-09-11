import { z } from "zod";

// Kept in sync by hand with packages/database/prisma/schema.prisma enums, same discipline
// as incident.ts — see its header comment.

export const ResolutionMode = z.enum(["OBSERVE_ONLY", "RECOMMEND", "HUMAN_APPROVED", "AUTONOMOUS"]);
export type ResolutionMode = z.infer<typeof ResolutionMode>;

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const PolicyBehavior = z.enum(["AUTO", "APPROVAL", "DENY"]);
export type PolicyBehavior = z.infer<typeof PolicyBehavior>;

export const ApprovalStatus = z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const RemediationStatus = z.enum([
  "PENDING",
  "APPROVED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "ROLLED_BACK",
]);
export type RemediationStatus = z.infer<typeof RemediationStatus>;

export const VerificationStatus = z.enum(["PENDING", "PASSED", "FAILED", "RETRYING"]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;
