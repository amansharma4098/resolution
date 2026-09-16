"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

type Tool = { key: string; enabled: boolean; mutating: boolean; fingerprint?: string };
export function RecoveryRuleForm({
  serverId,
  action,
  tools,
  saved,
}: {
  serverId: string;
  action: Tool;
  tools: Tool[];
  saved?: Record<string, unknown>;
}) {
  const { currentTenantId } = useSession();
  const [tool, setTool] = useState(String(saved?.tool ?? ""));
  const [input, setInput] = useState(JSON.stringify(saved?.input ?? {}));
  const [bindings, setBindings] = useState(JSON.stringify(saved?.inputBindings ?? {}));
  const [path, setPath] = useState(String(saved?.resultPath ?? "healthy"));
  const [expected, setExpected] = useState(JSON.stringify(saved?.equals ?? true));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="mt-3 rounded border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Recovery check {saved ? "· configured" : "· required for automatic resolution"}
      </summary>
      <p className="my-3 text-xs text-subink">
        Choose a read-only tool that checks service health after this repair. A successful repair
        call alone cannot resolve an incident. Review the health field and target mapping against
        your tool documentation.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Health-check tool
          <select
            aria-label={`Health-check tool for ${action.key}`}
            className="mt-1 w-full rounded border border-border bg-surface p-2"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
          >
            <option value="">Select an enabled read-only tool</option>
            {tools
              .filter((t) => t.enabled && !t.mutating)
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key}
                </option>
              ))}
          </select>
        </label>
        <label>
          Health field in JSON response
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="service.healthy"
          />
        </label>
        <label>
          Expected value (JSON scalar)
          <Input
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            placeholder='true or "healthy"'
          />
        </label>
        <label>
          Fixed check parameters (JSON)
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"region":"us-east-1"}'
          />
        </label>
        <label className="sm:col-span-2">
          Copy repair inputs into check parameters (JSON)
          <Input
            value={bindings}
            onChange={(e) => setBindings(e.target.value)}
            placeholder='{"serviceId":"serviceId"}'
          />
          <span className="text-xs text-subink">
            Example: {`{"serviceId":"serviceId"}`} checks the same service that was repaired. Dot
            paths can read nested repair inputs.
          </span>
        </label>
      </div>
      <Button
        size="sm"
        className="mt-3"
        disabled={busy || !tool || !currentTenantId}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            await apiRequest(
              `/api/map-servers/${serverId}/capabilities/${encodeURIComponent(action.key)}/recovery`,
              {
                method: "PUT",
                tenantId: currentTenantId!,
                body: {
                  tool,
                  input: JSON.parse(input),
                  inputBindings: JSON.parse(bindings),
                  resultPath: path,
                  equals: JSON.parse(expected),
                  actionFingerprint: action.fingerprint,
                  verifierFingerprint: tools.find((t) => t.key === tool)?.fingerprint,
                },
              },
            );
            setMessage(
              "Recovery check saved. Repair and health tools must stay enabled and unchanged.",
            );
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not save recovery check");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : "Save recovery check"}
      </Button>
      {message && (
        <p className="mt-2 text-xs" role="status">
          {message}
        </p>
      )}
    </details>
  );
}
