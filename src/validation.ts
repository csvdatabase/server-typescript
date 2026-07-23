import type {
  Expr,
  OrderBy,
  QueryPlan,
  Row,
  RowValue,
  TableSchema
} from "@csvdatabase/csdb";
import type {
  ByPrimaryKeyCommand,
  CommandRequest,
  SerializeCommand,
  ServerCommand,
  SqlCommand
} from "./contracts.js";
import { InvalidRequestError } from "./http-errors.js";

type UnknownObject = Record<string, unknown>;
type ComparisonOp = "=" | "!=" | "<>" | ">" | ">=" | "<" | "<=";
type JoinPlan = Extract<QueryPlan, { kind: "select" }>["joins"][number];

const DATABASE_NAME = /^[A-Za-z0-9_$-][A-Za-z0-9._$-]{0,127}$/;
const COMPARISON_OPERATORS = new Set<ComparisonOp>(["=", "!=", "<>", ">", ">=", "<", "<="]);

export function parseCommandRequest(value: unknown): CommandRequest {
  const request = objectValue(value, "request");
  exactKeys(request, ["database", "command"], "request");
  const database = stringValue(request.database, "database");
  if (!DATABASE_NAME.test(database)) {
    throw new InvalidRequestError(
      "database must be 1-128 characters using letters, numbers, _, $, ., or - and cannot start with a dot."
    );
  }
  return {
    database,
    command: parseCommand(request.command)
  };
}

function parseCommand(value: unknown): ServerCommand {
  const command = objectValue(value, "command");
  const kind = stringValue(command.kind, "command.kind");
  switch (kind) {
    case "select":
      return parseSelect(command);
    case "insert":
      return parseInsert(command);
    case "update":
      return parseUpdate(command);
    case "delete":
      return parseDelete(command);
    case "create-table":
      return parseCreateTable(command);
    case "drop-table":
      return parseDropTable(command);
    case "sql":
      return parseSql(command);
    case "by-primary-key":
      return parseByPrimaryKey(command);
    case "validate":
      exactKeys(command, ["kind"], "command");
      return { kind: "validate" };
    case "serialize":
      return parseSerialize(command);
    default:
      throw new InvalidRequestError(`Unsupported command.kind "${kind}".`);
  }
}

function parseSelect(command: UnknownObject): Extract<QueryPlan, { kind: "select" }> {
  exactKeys(
    command,
    ["kind", "table", "alias", "columns", "joins", "where", "orderBy", "limit", "output"],
    "command"
  );
  const result: Extract<QueryPlan, { kind: "select" }> = {
    kind: "select",
    table: nameValue(command.table, "command.table"),
    columns: parseColumns(command.columns),
    joins: arrayValue(command.joins, "command.joins").map((join, index) =>
      parseJoin(join, `command.joins[${index}]`)
    ),
    orderBy: arrayValue(command.orderBy, "command.orderBy").map((order, index) =>
      parseOrderBy(order, `command.orderBy[${index}]`)
    )
  };
  if (command.alias !== undefined) result.alias = nameValue(command.alias, "command.alias");
  if (command.where !== undefined) result.where = parseExpression(command.where, "command.where");
  if (command.limit !== undefined) result.limit = nonNegativeInteger(command.limit, "command.limit");
  if (command.output !== undefined) {
    const output = stringValue(command.output, "command.output");
    if (output !== "objects" && output !== "flat") {
      throw new InvalidRequestError('command.output must be "objects" or "flat".');
    }
    result.output = output;
  }
  return result;
}

function parseInsert(command: UnknownObject): Extract<QueryPlan, { kind: "insert" }> {
  exactKeys(command, ["kind", "table", "rows"], "command");
  const values = arrayValue(command.rows, "command.rows");
  if (values.length === 0) throw new InvalidRequestError("command.rows must not be empty.");
  return {
    kind: "insert",
    table: nameValue(command.table, "command.table"),
    rows: values.map((row, index) => parseRow(row, `command.rows[${index}]`))
  };
}

function parseUpdate(command: UnknownObject): Extract<QueryPlan, { kind: "update" }> {
  exactKeys(command, ["kind", "table", "set", "where"], "command");
  const set = parseRow(command.set, "command.set");
  if (Object.keys(set).length === 0) throw new InvalidRequestError("command.set must not be empty.");
  const result: Extract<QueryPlan, { kind: "update" }> = {
    kind: "update",
    table: nameValue(command.table, "command.table"),
    set
  };
  if (command.where !== undefined) result.where = parseExpression(command.where, "command.where");
  return result;
}

function parseDelete(command: UnknownObject): Extract<QueryPlan, { kind: "delete" }> {
  exactKeys(command, ["kind", "table", "where"], "command");
  const result: Extract<QueryPlan, { kind: "delete" }> = {
    kind: "delete",
    table: nameValue(command.table, "command.table")
  };
  if (command.where !== undefined) result.where = parseExpression(command.where, "command.where");
  return result;
}

function parseCreateTable(command: UnknownObject): Extract<QueryPlan, { kind: "create-table" }> {
  exactKeys(command, ["kind", "schema"], "command");
  const schemaValue = objectValue(command.schema, "command.schema");
  assertJsonValue(schemaValue, "command.schema");
  nameValue(schemaValue.name, "command.schema.name");
  const columns = objectValue(schemaValue.columns, "command.schema.columns");
  if (Object.keys(columns).length === 0) {
    throw new InvalidRequestError("command.schema.columns must not be empty.");
  }
  return { kind: "create-table", schema: schemaValue as TableSchema };
}

function parseDropTable(command: UnknownObject): Extract<QueryPlan, { kind: "drop-table" }> {
  exactKeys(command, ["kind", "table"], "command");
  return { kind: "drop-table", table: nameValue(command.table, "command.table") };
}

function parseSql(command: UnknownObject): SqlCommand {
  exactKeys(command, ["kind", "statement", "params"], "command");
  const statement = stringValue(command.statement, "command.statement");
  if (statement.trim() === "") throw new InvalidRequestError("command.statement must not be empty.");
  const result: SqlCommand = { kind: "sql", statement };
  if (command.params !== undefined) {
    result.params = arrayValue(command.params, "command.params").map((value, index) => {
      assertJsonValue(value, `command.params[${index}]`);
      return value as RowValue;
    });
  }
  return result;
}

function parseByPrimaryKey(command: UnknownObject): ByPrimaryKeyCommand {
  exactKeys(command, ["kind", "table", "key"], "command");
  if (command.key === undefined || command.key === null) {
    throw new InvalidRequestError("command.key is required and cannot be null.");
  }
  assertJsonValue(command.key, "command.key");
  if (Array.isArray(command.key) && command.key.length === 0) {
    throw new InvalidRequestError("command.key must not be an empty array.");
  }
  return {
    kind: "by-primary-key",
    table: nameValue(command.table, "command.table"),
    key: command.key as RowValue | RowValue[]
  };
}

function parseSerialize(command: UnknownObject): SerializeCommand {
  exactKeys(command, ["kind", "options"], "command");
  if (command.options === undefined) return { kind: "serialize" };
  const options = objectValue(command.options, "command.options");
  exactKeys(options, ["machineIndexes"], "command.options");
  if (options.machineIndexes === undefined) return { kind: "serialize", options: {} };
  const machineIndexes = stringValue(options.machineIndexes, "command.options.machineIndexes");
  if (machineIndexes !== "auto" && machineIndexes !== "omit") {
    throw new InvalidRequestError('command.options.machineIndexes must be "auto" or "omit".');
  }
  return { kind: "serialize", options: { machineIndexes } };
}

function parseColumns(value: unknown): string[] | "*" {
  if (value === "*") return "*";
  const columns = arrayValue(value, "command.columns").map((column, index) =>
    nameValue(column, `command.columns[${index}]`)
  );
  if (columns.length === 0) throw new InvalidRequestError('command.columns must be "*" or a non-empty array.');
  return columns;
}

function parseJoin(value: unknown, path: string): JoinPlan {
  const join = objectValue(value, path);
  exactKeys(join, ["table", "alias", "relationship", "on"], path);
  const result: JoinPlan = { table: nameValue(join.table, `${path}.table`) };
  if (join.alias !== undefined) result.alias = nameValue(join.alias, `${path}.alias`);
  if (join.relationship !== undefined) {
    result.relationship = nameValue(join.relationship, `${path}.relationship`);
  }
  if (join.on !== undefined) result.on = parseExpression(join.on, `${path}.on`);
  return result;
}

function parseOrderBy(value: unknown, path: string): OrderBy {
  const order = objectValue(value, path);
  exactKeys(order, ["column", "direction"], path);
  const direction = stringValue(order.direction, `${path}.direction`);
  if (direction !== "asc" && direction !== "desc") {
    throw new InvalidRequestError(`${path}.direction must be "asc" or "desc".`);
  }
  return { column: nameValue(order.column, `${path}.column`), direction };
}

function parseExpression(value: unknown, path: string, depth = 0): Expr {
  if (depth > 64) throw new InvalidRequestError(`${path} exceeds the maximum expression depth.`);
  const expression = objectValue(value, path);
  const type = stringValue(expression.type, `${path}.type`);
  switch (type) {
    case "literal":
      exactKeys(expression, ["type", "value"], path);
      if (!("value" in expression)) throw new InvalidRequestError(`${path}.value is required.`);
      assertJsonValue(expression.value, `${path}.value`);
      return { type, value: expression.value as RowValue };
    case "identifier":
      exactKeys(expression, ["type", "name"], path);
      return { type, name: nameValue(expression.name, `${path}.name`) };
    case "comparison": {
      exactKeys(expression, ["type", "op", "left", "right"], path);
      const op = stringValue(expression.op, `${path}.op`) as ComparisonOp;
      if (!COMPARISON_OPERATORS.has(op)) {
        throw new InvalidRequestError(`${path}.op is not a supported comparison operator.`);
      }
      return {
        type,
        op,
        left: parseExpression(expression.left, `${path}.left`, depth + 1),
        right: parseExpression(expression.right, `${path}.right`, depth + 1)
      };
    }
    case "is-null":
      exactKeys(expression, ["type", "expr", "not"], path);
      return {
        type,
        expr: parseExpression(expression.expr, `${path}.expr`, depth + 1),
        not: booleanValue(expression.not, `${path}.not`)
      };
    case "and":
    case "or":
      exactKeys(expression, ["type", "left", "right"], path);
      return {
        type,
        left: parseExpression(expression.left, `${path}.left`, depth + 1),
        right: parseExpression(expression.right, `${path}.right`, depth + 1)
      };
    case "not":
      exactKeys(expression, ["type", "expr"], path);
      return { type, expr: parseExpression(expression.expr, `${path}.expr`, depth + 1) };
    default:
      throw new InvalidRequestError(`${path}.type "${type}" is not supported.`);
  }
}

function parseRow(value: unknown, path: string): Row {
  const row = objectValue(value, path);
  for (const [key, item] of Object.entries(row)) assertJsonValue(item, `${path}.${key}`);
  return row as Row;
}

function assertJsonValue(value: unknown, path: string, depth = 0): void {
  if (depth > 64) throw new InvalidRequestError(`${path} exceeds the maximum JSON depth.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidRequestError(`${path} must be a finite JSON number.`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new InvalidRequestError(`${path} is not a safe JSON integer; send it as a decimal string.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${path}.${key}`, depth + 1);
    return;
  }
  throw new InvalidRequestError(`${path} must contain only JSON values.`);
}

function exactKeys(object: UnknownObject, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(object).find((key) => !allowedSet.has(key));
  if (extra) throw new InvalidRequestError(`${path}.${extra} is not supported.`);
}

function objectValue(value: unknown, path: string): UnknownObject {
  if (!isObject(value)) throw new InvalidRequestError(`${path} must be a JSON object.`);
  return value;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidRequestError(`${path} must be an array.`);
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new InvalidRequestError(`${path} must be a string.`);
  return value;
}

function nameValue(value: unknown, path: string): string {
  const name = stringValue(value, path);
  if (name.length === 0) throw new InvalidRequestError(`${path} must not be empty.`);
  return name;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new InvalidRequestError(`${path} must be a boolean.`);
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidRequestError(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
