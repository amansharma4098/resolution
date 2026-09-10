import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ForbiddenError } from "@resolution/security";
import { AppError } from "../lib/errors";

/**
 * The one place that turns a thrown error into the `{ error: { code, message, requestId } }`
 * shape from ARCHITECTURE.md §9. A 500 never leaks the underlying error message to the
 * client (only logged server-side) — everything else does, since AppError subclasses are
 * deliberately written to be safe to show a user.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId },
      });
      return;
    }

    if (error instanceof ForbiddenError) {
      reply.status(403).send({
        error: { code: "FORBIDDEN", message: error.message, requestId },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          requestId,
          details: error.flatten(),
        },
      });
      return;
    }

    // Fastify's own schema-validation errors carry a `validation` array.
    if ("validation" in error && error.validation) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: error.message, requestId },
      });
      return;
    }

    request.log.error({ err: error, requestId }, "Unhandled error");
    reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Not found", requestId: request.id },
    });
  });
}
