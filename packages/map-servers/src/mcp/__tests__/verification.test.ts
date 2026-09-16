import { describe, expect, it } from "vitest";
import { mcpRecoverySpec } from "../verification";
const spec = mcpRecoverySpec({
  tool: "health",
  input: { region: "west" },
  inputBindings: { serviceId: "target.id" },
  resultPath: "service.healthy",
  equals: true,
  actionFingerprint: "a",
  verifierFingerprint: "b",
});
describe("MCP recovery rules", () => {
  it("binds the check to the repaired resource and rejects missing inputs", () => {
    expect(spec.buildInput({ target: { id: "service-1" } }, {})).toEqual({
      region: "west",
      serviceId: "service-1",
    });
    expect(() => spec.buildInput({}, {})).toThrow("missing action input");
  });
  it("requires the exact structured health value; prose and successful calls cannot pass", () => {
    expect(
      spec.classify({ content: [{ type: "text", text: "Successfully restarted service" }] }),
    ).toBe("RETRYING");
    expect(
      spec.classify({ content: [{ type: "text", text: '{"service":{"healthy":"true"}}' }] }),
    ).toBe("RETRYING");
    expect(
      spec.classify({ content: [{ type: "text", text: '{"service":{"healthy":true}}' }] }),
    ).toBe("PASSED");
    expect(spec.classify({ structuredContent: { service: { healthy: false } } })).toBe("RETRYING");
    expect(spec.classify({ structuredContent: { service: { healthy: true } } })).toBe("PASSED");
  });
});
