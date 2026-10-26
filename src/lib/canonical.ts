import { keccak256, stringToBytes, type Hex } from "viem";

/**
 * Deterministic JSON: object keys sorted (by UTF-16 code unit), no whitespace, arrays kept in
 * order. Rejects values that have no stable JSON form (undefined, functions, bigint, NaN/∞).
 * The keccak256 of this string is what goes on-chain as a terms / submission / reason hash.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Non-finite number in canonical JSON");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`Unsupported value in canonical JSON: ${typeof value}`);
  }
}

export function canonicalHash(value: unknown): Hex {
  return keccak256(stringToBytes(canonicalize(value)));
}
