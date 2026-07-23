import { CSDBError, SQLError, ValidationError } from "@csvdatabase/csdb";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly expose = true
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class InvalidRequestError extends HttpError {
  constructor(message: string) {
    super(400, "INVALID_REQUEST", message);
    this.name = "InvalidRequestError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor() {
    super(401, "UNAUTHORIZED", "A valid bearer token is required.");
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof SQLError) return new HttpError(422, "SQL_ERROR", error.message);
  if (error instanceof ValidationError) {
    return new HttpError(422, "VALIDATION_ERROR", error.message);
  }
  if (error instanceof CSDBError) {
    if (/^Unknown table\b/.test(error.message)) return new NotFoundError(error.message);
    return new HttpError(422, "CSDB_ERROR", error.message);
  }
  if (isNodeError(error) && error.code === "ENOENT") {
    return new NotFoundError("Database not found.");
  }
  return new HttpError(500, "INTERNAL_ERROR", "An unexpected server error occurred.", false);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
