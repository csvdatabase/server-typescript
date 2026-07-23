import type { QueryPlan, RowValue } from "@csvdatabase/csdb";

export interface SqlCommand {
  kind: "sql";
  statement: string;
  params?: RowValue[];
}

export interface ByPrimaryKeyCommand {
  kind: "by-primary-key";
  table: string;
  key: RowValue | RowValue[];
}

export interface ValidateCommand {
  kind: "validate";
}

export interface SerializeCommand {
  kind: "serialize";
  options?: {
    machineIndexes?: "auto" | "omit";
  };
}

export type ServerCommand =
  | QueryPlan
  | SqlCommand
  | ByPrimaryKeyCommand
  | ValidateCommand
  | SerializeCommand;

export interface CommandRequest {
  database: string;
  command: ServerCommand;
}

export type CommandResult =
  | { rows: unknown[] }
  | { rowsAffected: number }
  | { row: unknown | null }
  | { valid: true }
  | { text: string };

export interface SuccessResponse {
  ok: true;
  result: CommandResult;
}

export interface ErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}
