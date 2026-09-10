import { describe, expect, it, vi } from "vitest";
import { writeAuditLog } from "../audit";

describe("writeAuditLog", () => {
  it("persists the entry", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { auditLog: { create } };

    await writeAuditLog(db, {
      organizationId: "org-1",
      actorType: "user",
      actorId: "user-1",
      action: "credential.created",
      metadata: { provider: "jira" },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        action: "credential.created",
        metadata: { provider: "jira" },
      }),
    });
  });

  it("redacts sensitive metadata keys before persisting", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { auditLog: { create } };

    await writeAuditLog(db, {
      organizationId: "org-1",
      actorType: "user",
      action: "credential.created",
      metadata: { password: "hunter2", apiKey: "sk-live-abc", provider: "aws" },
    });

    const call = create.mock.calls[0]![0] as { data: { metadata: Record<string, unknown> } };
    expect(call.data.metadata).toEqual({
      password: "[REDACTED]",
      apiKey: "[REDACTED]",
      provider: "aws",
    });
  });
});
