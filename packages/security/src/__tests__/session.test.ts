import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "../session";

const SECRET = "test-secret-do-not-use-in-prod";

describe("session", () => {
  it("round-trips a valid token", async () => {
    const token = await signSession({ sub: "user-123" }, SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload?.sub).toBe("user-123");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession({ sub: "user-123" }, SECRET);
    expect(await verifySession(token, "a-different-secret")).toBeNull();
  });

  it("rejects garbage input", async () => {
    expect(await verifySession("not-a-jwt", SECRET)).toBeNull();
  });
});
