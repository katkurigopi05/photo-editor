import { describe, expect, it } from "vitest";
import {
  EyedropperController,
  hexToRgb,
  isEyeDropperSupported,
  rgbToHex,
  rgbToHsl,
  samplePixelFromImageData,
  type NativeEyeDropperInstance,
} from "../src/eyedropper.js";

describe("Eyedropper and Color Sampler", () => {
  describe("color conversions", () => {
    it("converts rgb to hex and back", () => {
      expect(rgbToHex(255, 0, 128)).toBe("#ff0080");
      expect(hexToRgb("#ff0080")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
      expect(hexToRgb("#f08")).toEqual({ r: 255, g: 0, b: 136, a: 1 });
    });

    it("clamps invalid out-of-range rgb values", () => {
      expect(rgbToHex(300, -20, 100.4)).toBe("#ff0064");
    });

    it("throws on invalid hex string", () => {
      expect(() => hexToRgb("not-a-color")).toThrow("Invalid hex color");
    });

    it("converts rgb to hsl correctly", () => {
      // Pure red
      expect(rgbToHsl(255, 0, 0)).toEqual({ h: 0, s: 100, l: 50 });
      // Pure green
      expect(rgbToHsl(0, 255, 0)).toEqual({ h: 120, s: 100, l: 50 });
      // Pure blue
      expect(rgbToHsl(0, 0, 255)).toEqual({ h: 240, s: 100, l: 50 });
      // Pure white
      expect(rgbToHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 100 });
      // Pure black
      expect(rgbToHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
    });
  });

  describe("samplePixelFromImageData", () => {
    it("reads color at specified pixel coordinate", () => {
      const width = 2;
      const height = 2;
      // 4 pixels: (0,0)=red, (1,0)=green, (0,1)=blue, (1,1)=white
      const data = new Uint8ClampedArray([
        255, 0, 0, 255,       0, 255, 0, 255,
        0, 0, 255, 255,     255, 255, 255, 255,
      ]);
      const imgData = { data, width, height } as ImageData;

      const p00 = samplePixelFromImageData(imgData, 0, 0);
      expect(p00.hex).toBe("#ff0000");

      const p10 = samplePixelFromImageData(imgData, 1, 0);
      expect(p10.hex).toBe("#00ff00");

      const p01 = samplePixelFromImageData(imgData, 0, 1);
      expect(p01.hex).toBe("#0000ff");

      const p11 = samplePixelFromImageData(imgData, 1, 1);
      expect(p11.hex).toBe("#ffffff");
    });

    it("clamps out-of-bounds coordinates to nearest boundary pixel", () => {
      const data = new Uint8ClampedArray([255, 128, 0, 255]);
      const imgData = { data, width: 1, height: 1 } as ImageData;

      const sampled = samplePixelFromImageData(imgData, 100, -50);
      expect(sampled.hex).toBe("#ff8000");
    });
  });

  describe("EyedropperController", () => {
    it("detects support via dependencies", () => {
      class FakeEyeDropper implements NativeEyeDropperInstance {
        async open() {
          return { sRGBHex: "#123456" };
        }
      }
      expect(isEyeDropperSupported({ EyeDropperCtor: FakeEyeDropper })).toBe(true);
      expect(isEyeDropperSupported({ EyeDropperCtor: null })).toBe(false);
    });

    it("picks color from screen and updates history", async () => {
      class FakeEyeDropper implements NativeEyeDropperInstance {
        async open() {
          return { sRGBHex: "#3b82f6" };
        }
      }

      const controller = new EyedropperController({
        EyeDropperCtor: FakeEyeDropper,
        now: () => 12345,
      });

      const picked = await controller.pickFromScreen();
      expect(picked).not.toBeNull();
      expect(picked?.hex).toBe("#3b82f6");
      expect(picked?.rgb).toEqual({ r: 59, g: 130, b: 246, a: 1 });
      expect(picked?.timestamp).toBe(12345);

      expect(controller.getHistory()).toHaveLength(1);
      expect(controller.getHistory()[0]!.hex).toBe("#3b82f6");
    });

    it("returns null when user aborts or cancels screen eyedropper", async () => {
      class AbortedEyeDropper implements NativeEyeDropperInstance {
        async open(): Promise<{ sRGBHex: string }> {
          const err = new Error("User canceled the selection");
          err.name = "AbortError";
          throw err;
        }
      }

      const controller = new EyedropperController({ EyeDropperCtor: AbortedEyeDropper });
      const result = await controller.pickFromScreen();
      expect(result).toBeNull();
      expect(controller.getHistory()).toHaveLength(0);
    });

    it("deduplicates color history and caps at maxHistory", () => {
      const controller = new EyedropperController({}, 3);

      const makeImg = (r: number, g: number, b: number) =>
        ({ data: new Uint8ClampedArray([r, g, b, 255]), width: 1, height: 1 } as ImageData);

      controller.pickFromImageData(makeImg(255, 0, 0), 0, 0); // #ff0000
      controller.pickFromImageData(makeImg(0, 255, 0), 0, 0); // #00ff00
      controller.pickFromImageData(makeImg(0, 0, 255), 0, 0); // #0000ff
      expect(controller.getHistory().map((c) => c.hex)).toEqual(["#0000ff", "#00ff00", "#ff0000"]);

      // Adding 4th item evicts oldest (#ff0000)
      controller.pickFromImageData(makeImg(255, 255, 0), 0, 0); // #ffff00
      expect(controller.getHistory().map((c) => c.hex)).toEqual(["#ffff00", "#0000ff", "#00ff00"]);

      // Re-picking #00ff00 moves it to the top without increasing length
      controller.pickFromImageData(makeImg(0, 255, 0), 0, 0);
      expect(controller.getHistory().map((c) => c.hex)).toEqual(["#00ff00", "#ffff00", "#0000ff"]);
    });
  });
});
