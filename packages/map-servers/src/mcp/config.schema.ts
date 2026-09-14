import { z } from "zod";

/** Org-entered config for a generic MCP Map Server — rendered by the same generic
 *  config-wizard UI every other provider uses (docs/map-server.md), no bespoke screen. */
export const McpConfigSchema = z.object({
  url: z.string().url("Must be a valid URL for the MCP server's endpoint"),
  /** Extra static headers this specific server needs beyond Authorization — e.g. a tenant
   *  or workspace id some MCP servers expect as a header rather than a tool argument. */
  headers: z.record(z.string()).optional(),
});

export type McpConfig = z.infer<typeof McpConfigSchema>;
