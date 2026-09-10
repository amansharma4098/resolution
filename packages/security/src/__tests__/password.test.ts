import { describe, expect, it } from "vitest";
import { hashPassword, isPasswordStrongEnough, verifyPassword } from "../password";

describe("password", () => {
  it("hashes and verifies correctly", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password against a hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("enforces a minimum length policy", () => {
    expect(isPasswordStrongEnough("short")).toBe(false);
    expect(isPasswordStrongEnough("this is long enough")).toBe(true);
  });
});
