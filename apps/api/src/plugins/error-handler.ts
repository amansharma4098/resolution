import type { Context } from "hono";
import { ZodError } from "zod";
import { ForbiddenError } from "@resolution/security";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * The one place that turns a thrown error into the `{ error: { code, message, requestId } }`
 * shape from ARCHITECTURE.md §9. A 500 never leaks the underlying error message to the
 * client (only logged server-side via console.error, which Wrangler/Cloudflare surfaces in
 * `wrangler tail`) — everything else does, since AppError subclasses are deliberately
 * written to be safe to show a user. Registered as `app.onError(handleError)`.
 */
export function handleError(err: Error, c: Context<AppEnv>): Response {
  const requestId = c.get("requestId");

  if (err instanceof AppError) {
    return c.json(
      { error: { code: err.code, message: err.message, requestId } },
      err.statusCode as 400 | 401 | 403 | 404 | 409,
    );
  }

  if (err instanceof ForbiddenError) {
    return c.json({ error: { code: "FORBIDDEN", message: err.message, requestId } }, 403);
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          requestId,
          details: err.flatten(),
        },
      },
      400,
    );
  }

  // eslint-disable-next-line no-console
  console.error(`[${requestId}] Unhandled error:`, err);
  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId } },
    500,
  );
}
