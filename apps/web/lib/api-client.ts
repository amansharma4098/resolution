/**
 * Thin fetch wrapper for apps/api. Always sends cookies (the session lives in an httpOnly
 * cookie, never in JS-accessible storage — see packages/security/src/session.ts) and
 * surfaces the API's `{ error: { code, message, requestId } }` shape as a typed error.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  organizationId?: string;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.organizationId) {
    headers["X-Organization-Id"] = options.organizationId;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const err = json?.error;
    throw new ApiError(
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? "Something went wrong",
      res.status,
      err?.requestId,
    );
  }

  return json as T;
}
