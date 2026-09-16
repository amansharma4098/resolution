export * from "./types";
export * from "./registry";
export * from "./capability-lookup";
// Exported for apps/api/src/worker.ts to register at boot — importing this named export
// has no side effect on the registry itself (see registry.ts's header comment on why
// registration is never automatic on package import).
export { fabricProvider } from "./fabric";
export { datadogProvider } from "./datadog";
// Reused directly by apps/api/src/routes/integrations.ts's Datadog Integration test
// route — "is this key pair valid" is the same question there as it is for the Map Server,
// so it reuses this same real client rather than a second one.
export { DatadogClient, DatadogApiError } from "./datadog";
export { mcpProvider } from "./mcp";
export type { McpTool, McpToolCallResult } from "./mcp";

export { mcpToolFingerprint } from "./mcp/capability";
export { mcpClientFromContext } from "./mcp/context";
