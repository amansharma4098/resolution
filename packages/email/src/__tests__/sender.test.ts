import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmailSender } from "../sender";

describe("createEmailSender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the console sender when no API key/from address is configured", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const sender = createEmailSender({});
    await sender.send({ to: "user@example.com", subject: "Hi", text: "hello" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0]?.[0]).toContain("user@example.com");
  });

  it("uses the real Resend sender once an API key and from-address are configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const sender = createEmailSender({ apiKey: "re_test", from: "Resolution <noreply@example.com>" });
    await sender.send({ to: "user@example.com", subject: "Hi", text: "hello" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when the Resend API responds with an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad request", { status: 400 }));

    const sender = createEmailSender({ apiKey: "re_test", from: "Resolution <noreply@example.com>" });
    await expect(sender.send({ to: "user@example.com", subject: "Hi", text: "hello" })).rejects.toThrow(
      /Resend API error 400/,
    );
  });
});
