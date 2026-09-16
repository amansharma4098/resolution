import { z } from "zod";

// SaaS connections are remote HTTPS endpoints. Private systems must use a gateway.
export function isPublicMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      host.includes(".") &&
      !host.endsWith(".") &&
      !/^[\d.]+$/.test(host) &&
      !host.includes(":") &&
      !/(^|\.)(localhost|local|internal|test|invalid|home|lan)$/.test(host)
    );
  } catch {
    return false;
  }
}

export const McpToolReviewSchema = z.object({
  fingerprint: z.string(),
  access: z.enum(["READ", "WRITE"]),
});

export const McpConfigSchema = z
  .object({
    url: z
      .string()
      .refine(
        isPublicMcpUrl,
        "Use a public HTTPS hostname without query parameters, credentials, or custom ports",
      ),
    // Only server-written reviews belong here. Secrets belong in the encrypted vault.
    toolReviews: z.record(McpToolReviewSchema).default({}),
    toolCatalog: z
      .record(
        z.object({
          fingerprint: z.string(),
          description: z.string(),
          inputSchema: z.record(z.unknown()),
        }),
      )
      .default({}),
    disabled: z.boolean().default(false),
  })
  .strict();
export type McpConfig = z.infer<typeof McpConfigSchema>;
