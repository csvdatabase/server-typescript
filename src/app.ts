import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import type { CommandResult, ErrorResponse } from "./contracts.js";
import { DatabaseService } from "./database-service.js";
import { HttpError, UnauthorizedError, normalizeError } from "./http-errors.js";
import { parseCommandRequest } from "./validation.js";
import { toWireValue, type JsonValue } from "./wire.js";

export interface Logger {
  info(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
}

export interface AppOptions {
  dataDir: string;
  maxBodyBytes?: number;
  apiKey?: string;
  logger?: Logger;
}

const consoleLogger: Logger = {
  info: (fields) => console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), ...fields })),
  error: (fields) => console.error(JSON.stringify({ level: "error", time: new Date().toISOString(), ...fields }))
};

export function createApp(options: AppOptions): Server {
  const databases = new DatabaseService(options.dataDir);
  const logger = options.logger ?? consoleLogger;
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  const server = createServer((request, response) => {
    void handleRequest(request, response, databases, logger, maxBodyBytes, options.apiKey);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.on("clientError", (_error, socket) => {
    if (!socket.writable) return;
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  databases: DatabaseService,
  logger: Logger,
  maxBodyBytes: number,
  apiKey: string | undefined
): Promise<void> {
  const started = performance.now();
  const requestId = `req_${randomUUID()}`;
  const method = request.method ?? "UNKNOWN";
  const pathname = requestPath(request);
  let errorForLog: unknown;
  try {
    if (method === "GET" && pathname === "/health") {
      sendJson(response, 200, { status: "ok" }, requestId);
      return;
    }
    if (pathname !== "/v1/commands") {
      throw new HttpError(404, "NOT_FOUND", "Route not found.");
    }
    if (method !== "POST") {
      response.setHeader("Allow", "POST");
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Only POST is allowed for this route.");
    }
    if (apiKey && !validBearerToken(request.headers.authorization, apiKey)) {
      throw new UnauthorizedError();
    }
    const body = await readJsonBody(request, maxBodyBytes);
    const command = parseCommandRequest(body);
    const result = await databases.execute(command.database, command.command);
    sendJson(response, 200, { ok: true, result }, requestId);
  } catch (error) {
    errorForLog = error;
    const normalized = normalizeError(error);
    if (normalized.status === 401) response.setHeader("WWW-Authenticate", "Bearer");
    const payload: ErrorResponse = {
      ok: false,
      error: { code: normalized.code, message: normalized.message },
      requestId
    };
    if (!response.headersSent) sendJson(response, normalized.status, payload, requestId);
    else response.destroy();
  } finally {
    const fields: Record<string, unknown> = {
      event: "request.complete",
      requestId,
      method,
      path: pathname,
      status: response.statusCode,
      durationMs: Math.round((performance.now() - started) * 100) / 100
    };
    if (errorForLog) {
      const error = errorForLog instanceof Error ? errorForLog : new Error(String(errorForLog));
      logger.error({ ...fields, error: { name: error.name, message: error.message, stack: error.stack } });
    } else {
      logger.info(fields);
    }
  }
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    request.resume();
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const contentLength = request.headers["content-length"];
  if (typeof contentLength === "string" && /^\d+$/.test(contentLength) && Number(contentLength) > maxBodyBytes) {
    request.resume();
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBodyBytes} bytes.`);
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > maxBodyBytes) {
      tooLarge = true;
      chunks.length = 0;
    } else if (!tooLarge) {
      chunks.push(buffer);
    }
  }
  if (tooLarge) throw new HttpError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBodyBytes} bytes.`);
  if (size === 0) throw new HttpError(400, "INVALID_REQUEST", "Request body must not be empty.");

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "Request body is not valid JSON.");
  }
}

function validBearerToken(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/invalid-url";
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: { status: string } | { ok: true; result: CommandResult } | ErrorResponse,
  requestId: string
): void {
  const value: JsonValue = toWireValue(payload);
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId
  });
  response.end(body);
}
