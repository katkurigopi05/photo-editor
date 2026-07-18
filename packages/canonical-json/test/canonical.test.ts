import { describe, expect, it } from "vitest";
import { canonicalEqual, canonicalStringify, deepClone } from "../src/index.js";

describe("canonicalStringify", () => {
  it("sorts object keys lexicographically by UTF-16 code unit, recursively", () => {
    const value = { b: 1, a: { z: 2, a: 3 }, A: 4 };
    // Uppercase 'A' (0x41) sorts before lowercase 'a' (0x61).
    expect(canonicalStringify(value)).toBe('{"A":4,"a":{"a":3,"z":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalStringify({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it("omits undefined-valued object properties", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("is stable regardless of insertion order", () => {
    const a = canonicalStringify({ one: 1, two: 2, three: 3 });
    const b = canonicalStringify({ three: 3, one: 1, two: 2 });
    expect(a).toBe(b);
  });

  it("throws on bigint", () => {
    expect(() => canonicalStringify({ n: 1n })).toThrow(TypeError);
  });

  it("throws on undefined array elements", () => {
    expect(() => canonicalStringify([1, undefined, 2])).toThrow(TypeError);
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalStringify(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalStringify(Number.POSITIVE_INFINITY)).toThrow(
      TypeError,
    );
  });
});

describe("canonicalEqual", () => {
  it("compares by canonical form, ignoring key order", () => {
    expect(canonicalEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(canonicalEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("deepClone", () => {
  it("shares no references with the input", () => {
    const input = { a: { b: [1, 2] } };
    const clone = deepClone(input);
    expect(clone).toEqual(input);
    expect(clone.a).not.toBe(input.a);
    expect(clone.a.b).not.toBe(input.a.b);
  });
});
