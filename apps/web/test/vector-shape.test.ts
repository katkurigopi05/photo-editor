import { describe, expect, it } from "vitest";

import {
  VECTOR_SHAPE_PRESETS,
  createVectorShapeSource,
} from "../src/vector-shape.js";

describe("vector shape sources", () => {
  it("offers stable cartoon shape presets", () => {
    expect(VECTOR_SHAPE_PRESETS.map((preset) => preset.id)).toEqual([
      "circle",
      "star",
      "speech-bubble",
    ]);
    expect(new Set(VECTOR_SHAPE_PRESETS.map((preset) => preset.label)).size).toBe(
      VECTOR_SHAPE_PRESETS.length,
    );
  });

  it("materializes deterministic SVG and a persistent data URI", () => {
    const first = createVectorShapeSource({
      kind: "star",
      fillHex: "#ffcc00",
      strokeHex: "#402000",
      width: 1024,
      height: 1024,
    });
    const second = createVectorShapeSource({
      kind: "star",
      fillHex: "#ffcc00",
      strokeHex: "#402000",
      width: 1024,
      height: 1024,
    });

    expect(first).toEqual(second);
    expect(first.svg).toContain('viewBox="0 0 1024 1024"');
    expect(first.svg).toContain('aria-label="Cartoon star"');
    expect(first.svg).toContain('fill="#ffcc00"');
    expect(first.dataUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(first.dataUri.split(",")[1] ?? "")).toBe(
      first.svg,
    );
    expect(first.byteLength).toBe(new TextEncoder().encode(first.svg).length);
  });

  it.each(["circle", "star", "speech-bubble"] as const)(
    "renders a visible %s shape",
    (kind) => {
      const source = createVectorShapeSource({
        kind,
        fillHex: "#7c5cff",
        strokeHex: "#ffffff",
        width: 640,
        height: 360,
      });
      expect(source.svg).toContain("vector-effect=\"non-scaling-stroke\"");
      expect(source.svg).not.toContain("undefined");
    },
  );

  it("rejects invalid colors and unsafe dimensions", () => {
    const valid = {
      kind: "circle" as const,
      fillHex: "#7c5cff",
      strokeHex: "#ffffff",
      width: 1024,
      height: 1024,
    };
    expect(() =>
      createVectorShapeSource({ ...valid, fillHex: "red" }),
    ).toThrow(/color/i);
    expect(() => createVectorShapeSource({ ...valid, width: 0 })).toThrow(
      /dimension/i,
    );
    expect(() => createVectorShapeSource({ ...valid, height: 8192 })).toThrow(
      /dimension/i,
    );
  });
});
