import { accessSync, constants, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openCSDB, type CSDBDatabase, type Row } from "@csvdatabase/csdb";
import type { CommandResult, ServerCommand } from "./contracts.js";
import { NotFoundError } from "./http-errors.js";

export class DatabaseService {
  readonly dataDir: string;
  private readonly mutex = new KeyedMutex();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o750 });
    const information = lstatSync(dataDir);
    if (!information.isDirectory()) throw new Error(`CSDB data path is not a directory: ${dataDir}`);
    this.dataDir = realpathSync(dataDir);
    try {
      accessSync(this.dataDir, constants.R_OK | constants.W_OK);
    } catch (error) {
      throw new Error(`CSDB data directory must be readable and writable: ${this.dataDir}`, { cause: error });
    }
  }

  execute(database: string, command: ServerCommand): Promise<CommandResult> {
    return this.mutex.run(database, async () => {
      const path = this.databasePath(database);
      const information = safeLstat(path);
      if (!information || !information.isFile() || information.isSymbolicLink()) {
        throw new NotFoundError(`Database "${database}" was not found.`);
      }
      const db = await openCSDB(path, { autoSave: true });
      return dispatch(db, command);
    });
  }

  private databasePath(database: string): string {
    const path = resolve(this.dataDir, `${database}.csdb`);
    if (dirname(path) !== this.dataDir) throw new NotFoundError(`Database "${database}" was not found.`);
    return path;
  }
}

function dispatch(db: CSDBDatabase, command: ServerCommand): CommandResult {
  switch (command.kind) {
    case "select":
    case "insert":
    case "update":
    case "delete": {
      const result = db.execute(command);
      return Array.isArray(result) ? { rows: result } : result;
    }
    case "create-table":
      return db.createTable(command.schema);
    case "drop-table":
      return db.dropTable(command.table);
    case "sql": {
      const result = db.sql(command.statement, command.params ?? []);
      return Array.isArray(result) ? { rows: result } : result;
    }
    case "by-primary-key": {
      const row: Row | undefined = db.table(command.table).byPrimaryKey(command.key);
      return { row: row ?? null };
    }
    case "validate":
      db.validate();
      return { valid: true };
    case "serialize":
      return { text: db.toString(command.options) };
    default:
      return assertNever(command);
  }
}

function safeLstat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}

class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
