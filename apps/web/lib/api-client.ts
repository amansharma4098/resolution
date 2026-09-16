/**
 * Thin fetch wrapper for apps/api. Always sends cookies (the session lives in an httpOnly
 * cookie, never in JS-accessible storage — see packages/security/src/session.ts) and
 * surfaces the API's `{ error: { code, message, requestId } }` shape as a typed error.
 */
// Production uses the Pages /api proxy even when the build has no environment file.
// Next.js embeds this value in the browser bundle; never default production to localhost.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:8787" : "");

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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  tenantId?: string;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.tenantId) {
    headers["X-Tenant-Id"] = options.tenantId;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Unable to connect to Resolution. Check your connection and try again.",
      0,
    );
  }

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

  if (json === null) {
    throw new ApiError(
      "INVALID_RESPONSE",
      "Resolution returned an unexpected response. Refresh the page and try again.",
      res.status,
    );
  }
  return json as T;
}
