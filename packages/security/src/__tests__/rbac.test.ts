import { describe, expect, it } from "vitest";
import { ForbiddenError, hasRole, requireRole } from "../rbac";

describe("rbac", () => {
  it("ranks roles OWNER > ADMIN > MEMBER > VIEWER", () => {
    expect(hasRole("OWNER", "VIEWER")).toBe(true);
    expect(hasRole("OWNER", "OWNER")).toBe(true);
    expect(hasRole("VIEWER", "MEMBER")).toBe(false);
    expect(hasRole("MEMBER", "ADMIN")).toBe(false);
    expect(hasRole("ADMIN", "MEMBER")).toBe(true);
  });

  it("requireRole is a no-op when the role is sufficient", () => {
    expect(() => requireRole("OWNER", "ADMIN")).not.toThrow();
    expect(() => requireRole("ADMIN", "ADMIN")).not.toThrow();
  });

  it("requireRole throws ForbiddenError when the role is insufficient", () => {
    expect(() => requireRole("VIEWER", "ADMIN")).toThrow(ForbiddenError);
    expect(() => requireRole("MEMBER", "OWNER")).toThrow(/OWNER role or higher/);
  });
});
