/**
 * Canonical JSON serialization.
 *
 * "Byte-equivalent canonical JSON" is defined by these rules:
 *  - object keys sorted lexicographically by UTF-16 code unit, recursively;
 *  - arrays preserve element order;
 *  - no insignificant whitespace;
 *  - only JSON-native values (string, number, boolean, null, array, object);
 *    `bigint` and `undefined` must never reach the serializer.
 *
 * Absent optional fields must be omitted by the caller before serializing.
 * As a defensive measure, `undefined`-valued object properties are skipped
 * (mirroring `JSON.stringify`), while a `bigint` value, a non-finite number,
 * or `undefined` appearing as an array element throws, so that bugs surface
 * loudly instead of producing silently divergent output.
 */

/** A value that is safe to serialize to canonical JSON. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

class CanonicalJsonError extends TypeError {}

/**
 * The default string comparison operators (`<`, `>`) compare by UTF-16 code
 * unit, which is exactly the ordering required by the canonical form.
 */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function serialize(value: unknown): string {
  if (value === null) return "null";

  const type = typeof value;

  if (type === "string") return JSON.stringify(value);
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError(
        "cannot serialize a non-finite number to canonical JSON",
      );
    }
    return JSON.stringify(value);
  }
  if (type === "bigint") {
    throw new CanonicalJsonError(
      "cannot serialize a bigint to canonical JSON; convert to a string first",
    );
  }
  if (type === "undefined") {
    throw new CanonicalJsonError(
      "cannot serialize `undefined` to canonical JSON",
    );
  }

  if (Array.isArray(value)) {
    const parts = value.map((element) => {
      if (element === undefined) {
        throw new CanonicalJsonError(
          "cannot serialize `undefined` as an array element",
        );
      }
      return serialize(element);
    });
    return `[${parts.join(",")}]`;
  }

  if (type === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareCodeUnits);
    const parts = keys.map(
      (key) => `${JSON.stringify(key)}:${serialize(record[key])}`,
    );
    return `{${parts.join(",")}}`;
  }

  throw new CanonicalJsonError(`cannot serialize value of type ${type}`);
}

/** Serialize a value to its byte-equivalent canonical JSON string. */
export function canonicalStringify(value: unknown): string {
  return serialize(value);
}

/** True when two values produce identical canonical JSON. */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

/**
 * Structural deep clone that shares no references with the input. Implemented
 * via canonical round-trip so the result is guaranteed JSON-native and free of
 * `undefined` properties.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T;
}

/** Recursively freeze an object graph. Intended for defensive use in tests. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
