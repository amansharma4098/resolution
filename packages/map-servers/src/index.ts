export * from "./types";
export * from "./registry";
// Exported for apps/api/src/worker.ts to register at boot — importing this named export
// has no side effect on the registry itself (see registry.ts's header comment on why
// registration is never automatic on package import).
export { fabricProvider } from "./fabric";
