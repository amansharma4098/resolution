"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface IncidentSummary {
  id: string;
  source: string;
  title: string;
  status: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  createdAt: string;
}

type DisplayItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "incidents"; incidents: IncidentSummary[] };

/** The server returns the whole raw message array (user turns, assistant text/tool_use
 *  blocks, and the tool_result blocks fed back between turns) so it can be replayed as the
 *  next request's history — see apps/api/src/routes/chat.ts. This turns that into what's
 *  actually worth showing: real user/assistant text, plus a grouped-by-platform incident
 *  list whenever a `list_incidents` tool result comes back. Everything else (raw tool_use/
 *  tool_result plumbing) stays out of the transcript. */
function buildDisplayItems(messages: unknown[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown };
    if (message.role === "user") {
      if (typeof message.content === "string") {
        items.push({ kind: "user", text: message.content });
      } else if (Array.isArray(message.content)) {
        for (const block of message.content as Array<Record<string, unknown>>) {
          if (block.type !== "tool_result") continue;
          const text = typeof block.content === "string" ? block.content : "";
          try {
            const parsed: unknown = JSON.parse(text);
            if (
              Array.isArray(parsed) &&
              parsed.every((row) => row && typeof row === "object" && "source" in (row as object))
            ) {
              items.push({ kind: "incidents", incidents: parsed as IncidentSummary[] });
            }
          } catch {
            // Not a list_incidents result (or an error string) — nothing worth surfacing
            // as its own transcript item; the assistant's own text covers it.
          }
        }
      }
    } else if (message.role === "assistant") {
      const text =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? (message.content as Array<Record<string, unknown>>)
                .filter((block) => block.type === "text")
                .map((block) => String(block.text ?? ""))
                .join("\n")
            : "";
      if (text) items.push({ kind: "assistant", text });
    }
  }
  return items;
}

function groupBySource(incidents: IncidentSummary[]): Map<string, IncidentSummary[]> {
  const groups = new Map<string, IncidentSummary[]>();
  for (const incident of incidents) {
    const list = groups.get(incident.source) ?? [];
    list.push(incident);
    groups.set(incident.source, list);
  }
  return groups;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<p>Loading incident assistant…</p>}>
      <IncidentChat />
    </Suspense>
  );
}
function IncidentChat() {
  const params = useSearchParams();
  const [incidentId, setIncidentId] = useState(params.get("incidentId") ?? undefined);
  const [incidentTitle, setIncidentTitle] = useState<string>();
  const { currentTenantId } = useSession();
  const [messages, setMessages] = useState<unknown[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);
  const tenantRef = useRef(currentTenantId);
  tenantRef.current = currentTenantId;
  useEffect(() => {
    setMessages([]);
    setConversationId(undefined);
    setConversations([]);
    setError(null);
    setSending(false);
  }, [currentTenantId]);
  useEffect(() => {
    let active = true;
    if (currentTenantId)
      void apiRequest<{ conversations: Array<{ id: string; title: string }> }>(
        `/api/chat/conversations${incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : ""}`,
        { tenantId: currentTenantId },
      )
        .then((r) => {
          if (active && tenantRef.current === currentTenantId) setConversations(r.conversations);
        })
        .catch(() => {
          if (active) setError("Could not load saved conversations");
        });
    setIncidentTitle(undefined);
    if (currentTenantId && incidentId)
      void apiRequest<{ incident: { title: string } }>(`/api/incidents/${incidentId}`, {
        tenantId: currentTenantId,
      })
        .then((r) => {
          if (active && tenantRef.current === currentTenantId) setIncidentTitle(r.incident.title);
        })
        .catch(() => {
          if (active) setError("This incident is unavailable in the selected workspace");
        });
    return () => {
      active = false;
    };
  }, [currentTenantId, incidentId]);
  async function openConversation(id: string) {
    if (!currentTenantId || sending) return;
    if (!id) {
      setConversationId(undefined);
      setMessages([]);
      return;
    }
    try {
      const r = await apiRequest<{ messages: unknown[]; incidentId?: string }>(
        `/api/chat/conversations/${id}`,
        {
          tenantId: currentTenantId,
        },
      );
      if (tenantRef.current === currentTenantId) {
        setIncidentId(r.incidentId ?? undefined);
        setConversationId(id);
        setMessages(r.messages);
      }
    } catch {
      setError("Could not open conversation");
    }
  }
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async () => {
    if (!currentTenantId || !input.trim() || sending) return;
    const nextMessages = [...messages, { role: "user", content: input.trim() }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setSending(true);
    try {
      const res = await apiRequest<{
        messages: unknown[];
        isMock: boolean;
        conversationId: string;
      }>("/api/chat", {
        method: "POST",
        tenantId: currentTenantId,
        body: { conversationId, incidentId, message: input.trim() },
      });
      if (tenantRef.current !== currentTenantId) return;
      setConversationId(res.conversationId);
      setConversations((prev) =>
        prev.some((c) => c.id === res.conversationId)
          ? prev
          : [{ id: res.conversationId, title: input.trim().slice(0, 100) }, ...prev],
      );
      setMessages(res.messages);
      setMockMode(res.isMock);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      if (tenantRef.current === currentTenantId)
        setError(err instanceof ApiError ? err.message : "The assistant didn't respond");
    } finally {
      if (tenantRef.current === currentTenantId) setSending(false);
    }
  }, [currentTenantId, input, messages, sending, conversationId, incidentId]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const displayItems = buildDisplayItems(messages);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div>
        <span className="kicker">Assistant</span>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {incidentId ? "Incident assistant" : "AI assistant"}
        </h1>
        <p className="mt-1 text-sm text-subink">
          Ask about incidents across every connected platform, or tell it to resolve one — it
          investigates, proposes a remediation (picking whichever connected system can actually
          perform the fix), and directs you to review proposed actions in Approvals.
        </p>
      </div>

      {incidentId && (
        <div className="rounded border border-border bg-surface p-3 text-sm">
          <span className="kicker">Working on</span>
          <p className="mt-1 font-medium">{incidentTitle ?? "Loading incident…"}</p>
          <Link className="text-xs underline" href={`/dashboard/incidents/detail?id=${incidentId}`}>
            View evidence, actions and recovery checks
          </Link>
          <button
            className="ml-4 text-xs underline"
            disabled={sending}
            onClick={() => {
              setIncidentId(undefined);
              setMessages([]);
              setConversationId(undefined);
            }}
          >
            Workspace chat
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {(incidentId
          ? [
              "Explain the root cause and supporting evidence",
              "Give me ordered resolution steps, risks and recovery checks",
              "Propose a repair using the connected tools",
            ]
          : ["Show critical open incidents", "Which incidents need human approval?"]
        ).map((prompt) => (
          <Button
            size="sm"
            variant="secondary"
            key={prompt}
            disabled={sending}
            onClick={() => setInput(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <select
          aria-label="Saved conversations"
          className="rounded border border-border bg-surface p-2 text-sm"
          value={conversationId ?? ""}
          disabled={sending}
          onChange={(e) => void openConversation(e.target.value)}
        >
          <option value="">New conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <Link href="/dashboard/approvals" className="text-sm underline">
          Review approvals
        </Link>
      </div>
      {mockMode && (
        <p className="rounded border border-warning bg-background px-3 py-2 text-xs text-subink">
          Running in <span className="font-mono">MOCK_MODE</span> — no{" "}
          <span className="font-mono">ANTHROPIC_API_KEY</span> is configured, so the assistant
          can&apos;t reason about messages yet. Every tool it would call is fully real.
        </p>
      )}

      <Card className="flex flex-1 flex-col overflow-hidden">
        <CardContent className="flex flex-1 flex-col gap-3 overflow-y-auto py-4">
          {displayItems.length === 0 ? (
            <p className="text-sm text-subink">
              Try: &ldquo;what incidents are open right now?&rdquo; or &ldquo;resolve the latest
              critical incident&rdquo;.
            </p>
          ) : (
            displayItems.map((item, i) => {
              if (item.kind === "incidents") {
                return (
                  <div key={i} className="rounded border border-border bg-background p-3">
                    {[...groupBySource(item.incidents)].map(([source, incidents]) => (
                      <div key={source} className="mb-3 last:mb-0">
                        <p className="kicker">{source}</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {incidents.map((incident) => (
                            <li key={incident.id}>
                              <Link
                                href={`/dashboard/incidents/detail?id=${incident.id}`}
                                className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-surface"
                              >
                                <span className="text-ink">{incident.title}</span>
                                <span className="flex shrink-0 items-center gap-1.5">
                                  <StatusBadge status={domainStatusMap.severity[incident.severity]}>
                                    {incident.severity}
                                  </StatusBadge>
                                  <StatusBadge
                                    status={
                                      domainStatusMap.incidentStatus[
                                        incident.status as keyof typeof domainStatusMap.incidentStatus
                                      ] ?? "neutral"
                                    }
                                  >
                                    {incident.status}
                                  </StatusBadge>
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              }
              return (
                <div key={i} className={item.kind === "user" ? "self-end" : "self-start"}>
                  <div
                    className={`max-w-xl whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                      item.kind === "user"
                        ? "bg-navy text-white"
                        : "border border-border bg-background text-ink"
                    }`}
                  >
                    {item.text}
                  </div>
                </div>
              );
            })
          )}
          {sending && <p className="text-xs text-subink">Thinking…</p>}
          <div ref={bottomRef} />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-error">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Textarea
          rows={2}
          placeholder="Ask about incidents, or tell it to resolve one…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 resize-none"
        />
        <Button type="submit" disabled={sending || !input.trim()} className="self-end">
          Send
        </Button>
      </form>
    </div>
  );
}
