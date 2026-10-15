import { describe, expect, it, vi } from "vitest";
import {
  createGpuLutRenderer,
  type LutInterpolation,
} from "../src/gpu-lut.js";
import {
  identityCubeImage,
  cubeImageToLut,
} from "@director/raster-tools";

describe("gpu-lut renderer", () => {
  it("returns null safely when document is not defined", () => {
    // In node environment without DOM, createGpuLutRenderer falls back cleanly to null
    const origDoc = globalThis.document;
    try {
      (
        globalThis as unknown as { document?: Document | undefined }
      ).document = undefined;
      expect(createGpuLutRenderer()).toBeNull();
    } finally {
      if (origDoc !== undefined) {
        globalThis.document = origDoc;
      }
    }
  });

  it("handles empty passes and invalid dimensions cleanly in applyChain", () => {
    const mockGl = {
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      deleteShader: vi.fn(),
      getUniformLocation: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({})),
      createVertexArray: vi.fn(() => ({})),
      createFramebuffer: vi.fn(() => ({})),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D: vi.fn(),
      bindFramebuffer: vi.fn(),
      framebufferTexture2D: vi.fn(),
      activeTexture: vi.fn(),
      pixelStorei: vi.fn(),
      texImage3D: vi.fn(),
      bindVertexArray: vi.fn(),
      useProgram: vi.fn(),
      disable: vi.fn(),
      uniform2f: vi.fn(),
      uniform1f: vi.fn(),
      uniform1i: vi.fn(),
      viewport: vi.fn(),
      drawArrays: vi.fn(),
      getError: vi.fn(() => 0),
      deleteTexture: vi.fn(),
      deleteFramebuffer: vi.fn(),
      deleteVertexArray: vi.fn(),
      deleteProgram: vi.fn(),
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      TEXTURE_2D: 3553,
      TEXTURE_3D: 32879,
      TEXTURE0: 33984,
      TEXTURE1: 33985,
      TEXTURE2: 33986,
      LINEAR: 9729,
      CLAMP_TO_EDGE: 33071,
      RGB8: 32849,
      RGB: 6407,
      RGBA8: 32856,
      RGBA: 6408,
      R8: 33321,
      RED: 6403,
      UNSIGNED_BYTE: 5121,
      FRAMEBUFFER: 36160,
      COLOR_ATTACHMENT0: 36064,
      BLEND: 3042,
      TRIANGLES: 4,
      NO_ERROR: 0,
      UNPACK_ALIGNMENT: 3317,
    };

    const mockCanvas = {
      width: 100,
      height: 100,
      getContext: vi.fn((contextId: string) => {
        if (contextId === "webgl2") return mockGl;
        return null;
      }),
    };

    const origDoc = globalThis.document;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: vi.fn((tagName: string) => {
        if (tagName === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: vi.fn((contextId: string) => {
              if (contextId === "webgl2") return mockGl;
              return null;
            }),
          };
        }
        return {};
      }),
    };

    try {
      const renderer = createGpuLutRenderer();
      expect(renderer).not.toBeNull();
      if (renderer === null) return;

      const lut = cubeImageToLut(identityCubeImage());
      const dummyCanvas = mockCanvas as unknown as HTMLCanvasElement;

      // 0 width or height returns null
      expect(renderer.applyChain(dummyCanvas, 0, 100, [{ lut }])).toBeNull();
      expect(renderer.applyChain(dummyCanvas, 100, 0, [{ lut }])).toBeNull();

      // Empty passes array returns null
      expect(renderer.applyChain(dummyCanvas, 100, 100, [])).toBeNull();

      // Coverage length mismatch returns null
      const invalidCoverage = new Uint8ClampedArray(50);
      expect(
        renderer.applyChain(dummyCanvas, 100, 100, [
          { lut, coverage: invalidCoverage },
        ]),
      ).toBeNull();

      // Valid pass with default trilinear interpolation
      const outTrilinear = renderer.applyChain(dummyCanvas, 10, 10, [{ lut }]);
      expect(outTrilinear).toBe(renderer.canvas);

      // Valid pass with tetrahedral interpolation
      const outTetrahedral = renderer.applyChain(dummyCanvas, 10, 10, [
        { lut, interpolation: "tetrahedral" as LutInterpolation },
      ]);
      expect(outTetrahedral).toBe(renderer.canvas);

      // Verify disposal cleans up WebGL objects without error
      renderer.dispose();
      expect(mockGl.deleteProgram).toHaveBeenCalled();
      expect(mockGl.deleteVertexArray).toHaveBeenCalled();
    } finally {
      if (origDoc !== undefined) {
        globalThis.document = origDoc;
      } else {
        // @ts-expect-error restore undefined
        delete globalThis.document;
      }
    }
  });
});
