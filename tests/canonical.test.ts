import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalize } from "@/lib/canonical";

// These strings are hashed and stored on-chain as terms / submission / reason hashes,
// so their exact form must never drift.
describe("canonical JSON edge cases", () => {
  it("serialises primitives and empty containers deterministically", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize({ a: [], b: {} })).toBe('{"a":[],"b":{}}');
  });

  it("escapes quotes, backslashes and control characters like JSON.stringify", () => {
    const tricky = 'say "hi"\n\\';
    expect(canonicalize(tricky)).toBe(JSON.stringify(tricky));
    expect(canonicalize({ k: tricky })).toBe(`{"k":${JSON.stringify(tricky)}}`);
  });

  it("orders keys by UTF-16 code unit, so case and accents sort predictably", () => {
    expect(canonicalize({ b: 1, B: 2, a: 3, "é": 4 })).toBe('{"B":2,"a":3,"b":1,"é":4}');
  });

  it("drops undefined object values but keeps nulls", () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("rejects Infinity and nested unsupported values", () => {
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalize([1, [2, Symbol("x")]])).toThrow();
  });

  it("hashes are 32-byte hex strings and differ for any changed character", () => {
    const h = canonicalHash({ title: "Logo design" });
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(canonicalHash({ title: "Logo design." })).not.toBe(h);
  });
});
