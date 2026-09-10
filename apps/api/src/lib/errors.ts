/**
 * Every route throws one of these instead of hand-rolling a response — apps/api/src/plugins
 * /error-handler.ts is the single place that turns an error into the
 * `{ error: { code, message, requestId } }` shape from ARCHITECTURE.md §9.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public readonly details?: unknown) {
    super("VALIDATION_ERROR", message, 400);
  }
}
