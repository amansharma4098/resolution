import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "../session";

const SECRET = "test-secret-do-not-use-in-prod";

describe("session", () => {
  it("round-trips a valid token", () => {
    const token = signSession({ sub: "user-123" }, SECRET);
    const payload = verifySession(token, SECRET);
    expect(payload?.sub).toBe("user-123");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession({ sub: "user-123" }, SECRET);
    expect(verifySession(token, "a-different-secret")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifySession("not-a-jwt", SECRET)).toBeNull();
  });
});
