import { resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  maxBodyBytes: number;
  shutdownTimeoutMs: number;
  apiKey?: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const apiKey = environment.CSDB_API_KEY?.trim();
  return {
    host: environment.HOST?.trim() || "0.0.0.0",
    port: integerEnvironment(environment.PORT, "PORT", 3000, 1, 65535),
    dataDir: resolve(environment.CSDB_DATA_DIR?.trim() || "./data"),
    maxBodyBytes: integerEnvironment(
      environment.CSDB_MAX_BODY_BYTES,
      "CSDB_MAX_BODY_BYTES",
      1_048_576,
      1,
      100 * 1024 * 1024
    ),
    shutdownTimeoutMs: integerEnvironment(
      environment.CSDB_SHUTDOWN_TIMEOUT_MS,
      "CSDB_SHUTDOWN_TIMEOUT_MS",
      10_000,
      100,
      300_000
    ),
    ...(apiKey ? { apiKey } : {})
  };
}

function integerEnvironment(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
