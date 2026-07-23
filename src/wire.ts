export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function toWireValue(value: unknown): JsonValue {
  return convert(value, new WeakSet<object>(), "$", 0);
}

function convert(value: unknown, seen: WeakSet<object>, path: string, depth: number): JsonValue {
  if (depth > 128) throw new Error(`Response value at ${path} exceeds the maximum JSON depth.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "undefined") return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    assertNotCircular(value, seen, path);
    const converted = value.map((item, index) => convert(item, seen, `${path}[${index}]`, depth + 1));
    seen.delete(value);
    return converted;
  }
  if (typeof value === "object") {
    assertNotCircular(value, seen, path);
    const converted: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      converted[key] = convert(item, seen, `${path}.${key}`, depth + 1);
    }
    seen.delete(value);
    return converted;
  }
  throw new Error(`Response value at ${path} cannot be represented as JSON.`);
}

function assertNotCircular(value: object, seen: WeakSet<object>, path: string): void {
  if (seen.has(value)) throw new Error(`Response value at ${path} is circular.`);
  seen.add(value);
}
