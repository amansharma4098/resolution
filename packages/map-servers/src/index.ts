export * from "./types";
export * from "./registry";
export * from "./capability-lookup";
// Exported for apps/api/src/worker.ts to register at boot — importing this named export
// has no side effect on the registry itself (see registry.ts's header comment on why
// registration is never automatic on package import).
export { fabricProvider } from "./fabric";
export { mcpProvider } from "./mcp";
export type { McpTool, McpToolCallResult } from "./mcp";
