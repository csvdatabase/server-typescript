import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";
import { parseCSDB } from "@csvdatabase/csdb";
import { createApp, type AppOptions, type Logger } from "../src/app.js";
import { parseCommandRequest } from "../src/validation.js";

const fixturePath = new URL("../examples/payroll.csdb", import.meta.url);
const silentLogger: Logger = { info: () => undefined, error: () => undefined };

test("health and every documented command kind work through the HTTP API", async (context) => {
  const server = await startTestServer(context);

  const health = await fetch(`${server.url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const selected = await server.command({
    kind: "select",
    table: "workers",
    columns: ["id", "email"],
    joins: [],
    orderBy: [{ column: "id", direction: "asc" }],
    output: "objects"
  });
  assert.equal(selected.status, 200);
  assert.deepEqual(resultOf(await selected.json()).rows, [
    { id: "w_001", email: "ada@example.com" },
    { id: "w_002", email: "grace@example.com" }
  ]);

  const sql = await server.command({
    kind: "sql",
    statement: "SELECT id FROM workers WHERE email = ?",
    params: ["ada@example.com"]
  });
  assert.deepEqual(resultOf(await sql.json()).rows, [{ id: "w_001" }]);

  const inserted = await server.command({
    kind: "insert",
    table: "workers",
    rows: [{ id: "w_003", name: "Katherine Johnson", email: "kj@example.com" }]
  });
  assert.deepEqual(resultOf(await inserted.json()), { rowsAffected: 1 });

  const primaryKey = await server.command({ kind: "by-primary-key", table: "workers", key: "w_003" });
  assert.deepEqual(resultOf(await primaryKey.json()).row, {
    id: "w_003",
    name: "Katherine Johnson",
    email: "kj@example.com"
  });

  const updated = await server.command({
    kind: "update",
    table: "workers",
    set: { email: "katherine@example.com" },
    where: equality("id", "w_003")
  });
  assert.deepEqual(resultOf(await updated.json()), { rowsAffected: 1 });

  const created = await server.command({
    kind: "create-table",
    schema: {
      name: "numbers",
      columns: { id: "text", amount: "bigint" },
      required: ["id", "amount"],
      primary_key: { columns: ["id"] }
    }
  });
  assert.deepEqual(resultOf(await created.json()), { rowsAffected: 0 });

  await server.command({
    kind: "insert",
    table: "numbers",
    rows: [{ id: "large", amount: "9007199254740993" }]
  });
  const bigInteger = await server.command({
    kind: "select",
    table: "numbers",
    columns: "*",
    joins: [],
    orderBy: [],
    output: "objects"
  });
  assert.deepEqual(resultOf(await bigInteger.json()).rows, [
    { id: "large", amount: "9007199254740993" }
  ]);

  const serialized = await server.command({ kind: "serialize", options: { machineIndexes: "omit" } });
  assert.match(String(resultOf(await serialized.json()).text), /--- table:numbers:data/);

  const validated = await server.command({ kind: "validate" });
  assert.deepEqual(resultOf(await validated.json()), { valid: true });

  const deleted = await server.command({
    kind: "delete",
    table: "workers",
    where: equality("id", "w_003")
  });
  assert.deepEqual(resultOf(await deleted.json()), { rowsAffected: 1 });

  const dropped = await server.command({ kind: "drop-table", table: "numbers" });
  assert.deepEqual(resultOf(await dropped.json()), { rowsAffected: 0 });

  const persisted = parseCSDB(await readFile(server.databasePath, "utf8"));
  assert.equal(persisted.table("workers").byPrimaryKey("w_003"), undefined);
  assert.equal(persisted.document.tables.has("numbers"), false);
});

test("failed mutations roll back without changing the database file", async (context) => {
  const server = await startTestServer(context);
  const before = await readFile(server.databasePath, "utf8");
  const response = await server.command({
    kind: "insert",
    table: "workers",
    rows: [{ id: "w_bad", name: "Missing Email" }]
  });
  assert.equal(response.status, 422);
  const body = errorOf(await response.json());
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.match(body.requestId, /^req_/);
  assert.equal(await readFile(server.databasePath, "utf8"), before);
});

test("concurrent mutations to one database are serialized", async (context) => {
  const server = await startTestServer(context);
  const [first, second] = await Promise.all([
    server.command({
      kind: "insert",
      table: "workers",
      rows: [{ id: "w_003", name: "Katherine", email: "katherine@example.com" }]
    }),
    server.command({
      kind: "insert",
      table: "workers",
      rows: [{ id: "w_004", name: "Dorothy", email: "dorothy@example.com" }]
    })
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const saved = parseCSDB(await readFile(server.databasePath, "utf8"));
  assert.equal(saved.table("workers").byPrimaryKey("w_003")?.name, "Katherine");
  assert.equal(saved.table("workers").byPrimaryKey("w_004")?.name, "Dorothy");
});

test("request validation, resource errors, media types, and body limits are stable", async (context) => {
  const server = await startTestServer(context, { maxBodyBytes: 300 });

  const invalidDatabase = await post(server.url, {
    database: "../payroll",
    command: { kind: "validate" }
  });
  assert.equal(invalidDatabase.status, 400);
  assert.equal(errorOf(await invalidDatabase.json()).error.code, "INVALID_REQUEST");

  const unknownDatabase = await post(server.url, {
    database: "missing",
    command: { kind: "validate" }
  });
  assert.equal(unknownDatabase.status, 404);

  const unknownTable = await server.command({
    kind: "select",
    table: "missing",
    columns: "*",
    joins: [],
    orderBy: []
  });
  assert.equal(unknownTable.status, 404);

  const invalidSql = await server.command({ kind: "sql", statement: "VACUUM", params: [] });
  assert.equal(invalidSql.status, 422);
  assert.equal(errorOf(await invalidSql.json()).error.code, "SQL_ERROR");

  const extraField = await post(server.url, {
    database: "payroll",
    command: { kind: "validate", unexpected: true }
  });
  assert.equal(extraField.status, 400);

  const mediaType = await fetch(`${server.url}/v1/commands`, { method: "POST", body: "{}" });
  assert.equal(mediaType.status, 415);

  const tooLarge = await post(server.url, {
    database: "payroll",
    command: { kind: "sql", statement: `SELECT * FROM workers ${" ".repeat(400)}`, params: [] }
  });
  assert.equal(tooLarge.status, 413);
});

test("optional bearer authentication protects commands but not health", async (context) => {
  const server = await startTestServer(context, { apiKey: "correct horse battery staple" });
  assert.equal((await fetch(`${server.url}/health`)).status, 200);
  const unauthorized = await server.command({ kind: "validate" });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

  const authorized = await post(
    server.url,
    { database: "payroll", command: { kind: "validate" } },
    { Authorization: "Bearer correct horse battery staple" }
  );
  assert.equal(authorized.status, 200);
});

test("startup rejects a data directory that is not writable", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX directory permissions are required for this test.");
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "csdb-server-read-only-"));
  context.after(async () => {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  });
  await chmod(directory, 0o500);
  assert.throws(
    () => createApp({ dataDir: directory, logger: silentLogger }),
    /data directory must be readable and writable/
  );
});

test("command parser rejects unsafe integers and accepts documented expressions", () => {
  assert.throws(
    () =>
      parseCommandRequest({
        database: "payroll",
        command: { kind: "sql", statement: "SELECT ?", params: [9_007_199_254_740_992] }
      }),
    /decimal string/
  );

  assert.deepEqual(
    parseCommandRequest({
      database: "payroll",
      command: {
        kind: "delete",
        table: "workers",
        where: {
          type: "not",
          expr: {
            type: "is-null",
            expr: { type: "identifier", name: "email" },
            not: false
          }
        }
      }
    }).command.kind,
    "delete"
  );
});

interface RunningTestServer {
  url: string;
  databasePath: string;
  command(command: Record<string, unknown>): Promise<Response>;
}

async function startTestServer(
  context: TestContext,
  options: Omit<AppOptions, "dataDir" | "logger"> = {}
): Promise<RunningTestServer> {
  const directory = await mkdtemp(join(tmpdir(), "csdb-server-test-"));
  const databasePath = join(directory, "payroll.csdb");
  await writeFile(databasePath, await readFile(fixturePath, "utf8"), "utf8");
  const app = createApp({ dataDir: directory, logger: silentLogger, ...options });
  await new Promise<void>((resolve, reject) => {
    app.once("error", reject);
    app.listen(0, "127.0.0.1", () => {
      app.off("error", reject);
      resolve();
    });
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      app.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(directory, { recursive: true, force: true });
  });
  const address = app.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    databasePath,
    command: (command) => post(url, { database: "payroll", command })
  };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${url}/v1/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function equality(column: string, value: unknown): Record<string, unknown> {
  return {
    type: "comparison",
    op: "=",
    left: { type: "identifier", name: column },
    right: { type: "literal", value }
  };
}

function resultOf(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value) && value.ok === true && isRecord(value.result));
  return value.result;
}

function errorOf(value: unknown): { error: Record<string, unknown>; requestId: string } {
  assert.ok(isRecord(value) && value.ok === false && isRecord(value.error) && typeof value.requestId === "string");
  return { error: value.error, requestId: value.requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
