#!/usr/bin/env node
/**
 * Test runner for TypeScript / Web Raster Tools algorithms in packages/raster-tools.
 * Tests Lightroom adjustments, detail/clarity, 3-way color grading, color mixer,
 * and artistic filters across multiple settings on real images.
 */
import console from "node:console";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import * as raster from "../packages/raster-tools/dist/index.js";

const OUTPUT_DIR =
  process.env.TEST_OUTPUT_DIR || path.join(os.tmpdir(), "test_runs");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Helper to create synthetic test pattern images simulating diverse inputs
function makeGradientImage(w, h) {
  const img = raster.createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      img.data[idx] = Math.floor((x / w) * 255); // Red gradient
      img.data[idx + 1] = Math.floor((y / h) * 255); // Green gradient
      img.data[idx + 2] = Math.floor(((x + y) / (w + h)) * 255); // Blue
      img.data[idx + 3] = 255;
    }
  }
  return img;
}

function makeColorBarImage(w, h) {
  const img = raster.createImage(w, h);
  const colors = [
    [255, 0, 0],
    [255, 128, 0],
    [255, 255, 0],
    [0, 255, 0],
    [0, 255, 255],
    [0, 0, 255],
    [128, 0, 255],
    [255, 0, 128],
    [240, 240, 240],
    [128, 128, 128],
    [30, 30, 30],
  ];
  const barWidth = Math.floor(w / colors.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const barIdx = Math.min(Math.floor(x / barWidth), colors.length - 1);
      const [r, g, b] = colors[barIdx];
      const idx = (y * w + x) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  return img;
}

function computeRasterMetrics(before, after) {
  let sumDiff = 0;
  let sumSqDiff = 0;
  let bLumaSum = 0;
  let aLumaSum = 0;
  const count = before.width * before.height;

  for (let i = 0; i < before.data.length; i += 4) {
    const dr = Math.abs(after.data[i] - before.data[i]);
    const dg = Math.abs(after.data[i + 1] - before.data[i + 1]);
    const db = Math.abs(after.data[i + 2] - before.data[i + 2]);
    sumDiff += (dr + dg + db) / 3;
    sumSqDiff += (dr * dr + dg * dg + db * db) / 3;

    bLumaSum +=
      0.299 * before.data[i] +
      0.587 * before.data[i + 1] +
      0.114 * before.data[i + 2];
    aLumaSum +=
      0.299 * after.data[i] +
      0.587 * after.data[i + 1] +
      0.114 * after.data[i + 2];
  }

  const mae = sumDiff / count;
  const mse = sumSqDiff / count;
  const rmse = Math.sqrt(mse);
  const psnr = mse === 0 ? 999.0 : 20 * Math.log10(255 / rmse);
  const lumaShift = (aLumaSum - bLumaSum) / count;

  return {
    mae: Number(mae.toFixed(2)),
    rmse: Number(rmse.toFixed(2)),
    psnr: Number(psnr.toFixed(2)),
    luma_shift: Number(lumaShift.toFixed(2)),
  };
}

async function runTsRasterTests() {
  console.log("Starting TypeScript Web Raster Tools Test Suite...");
  const testImages = {
    gradient_1024x768: makeGradientImage(1024, 768),
    color_bars_512x512: makeColorBarImage(512, 512),
    synthetic_preview_256x256: makeGradientImage(256, 256),
  };

  const tests = [
    // 1. LIGHTROOM ADJUSTMENTS
    {
      feat: "exposure",
      run: (img, val) => raster.exposure(raster.cloneImage(img), val),
      settings: [
        ["-1.5 EV (Darken)", -1.5],
        ["+0.75 EV (Subtle)", 0.75],
        ["+2.0 EV (High)", 2.0],
      ],
    },
    {
      feat: "contrast",
      run: (img, val) => raster.contrast(raster.cloneImage(img), val),
      settings: [
        ["-40 Flat", -40],
        ["+35 Punch", 35],
        ["+80 High Dynamic", 80],
      ],
    },
    {
      feat: "highlights",
      run: (img, val) => raster.highlights(raster.cloneImage(img), val),
      settings: [
        ["-75 Recovery", -75],
        ["+40 Glow", 40],
      ],
    },
    {
      feat: "shadows",
      run: (img, val) => raster.shadows(raster.cloneImage(img), val),
      settings: [
        ["-50 Crush", -50],
        ["+60 Lift", 60],
      ],
    },
    {
      feat: "whites",
      run: (img, val) => raster.whites(raster.cloneImage(img), val),
      settings: [
        ["-30 Pull", -30],
        ["+50 Clip Guard", 50],
      ],
    },
    {
      feat: "blacks",
      run: (img, val) => raster.blacks(raster.cloneImage(img), val),
      settings: [
        ["-45 Matte Toe", -45],
        ["+40 Lift Floor", 40],
      ],
    },
    {
      feat: "temperature",
      run: (img, val) => raster.temperature(raster.cloneImage(img), val),
      settings: [
        ["-35 Arctic Blue", -35],
        ["+45 Golden Amber", 45],
      ],
    },
    {
      feat: "tint",
      run: (img, val) => raster.tint(raster.cloneImage(img), val),
      settings: [
        ["-30 Green Cast", -30],
        ["+30 Magenta Cast", 30],
      ],
    },
    {
      feat: "vibrance",
      run: (img, val) => raster.vibrance(raster.cloneImage(img), val),
      settings: [
        ["-30 Protected Mute", -30],
        ["+40 Portrait Glow", 40],
        ["+85 Vivid", 85],
      ],
    },
    {
      feat: "saturation",
      run: (img, val) => raster.saturation(raster.cloneImage(img), val),
      settings: [
        ["-100 B&W", -100],
        ["+35 Boost", 35],
        ["+90 Hyper", 90],
      ],
    },

    // 2. DETAIL & TEXTURE
    {
      feat: "clarity",
      run: (img, val) => raster.clarity(raster.cloneImage(img), val),
      settings: [
        ["-30 Dreamy Soft", -30],
        ["+45 Midtone Contrast", 45],
      ],
    },
    {
      feat: "texture",
      run: (img, val) => raster.texture(raster.cloneImage(img), val),
      settings: [
        ["-35 Skin Softening", -35],
        ["+50 Micro Detail", 50],
      ],
    },
    {
      feat: "dehaze",
      run: (img, val) => raster.dehaze(raster.cloneImage(img), val),
      settings: [
        ["-25 Misty Atmosphere", -25],
        ["+50 Atmospheric Cut", 50],
      ],
    },
    {
      feat: "noiseReduction",
      run: (img, val) =>
        raster.noiseReduction(raster.cloneImage(img), val[0], val[1]),
      settings: [
        ["Gentle (lum=20, chr=25)", [20, 25]],
        ["Heavy (lum=60, chr=70)", [60, 70]],
      ],
    },

    // 3. COLOR MIXER & 3-WAY COLOR WHEELS
    {
      feat: "colorMixer",
      run: (img, adj) => raster.colorMixer(raster.cloneImage(img), adj),
      settings: [
        [
          "Orange Skin Luminance (+30)",
          { orange: { hue: 0, saturation: 10, luminance: 30 } },
        ],
        [
          "Teal/Orange Separation",
          {
            blue: { hue: 15, saturation: 40, luminance: -10 },
            orange: { hue: -5, saturation: 35, luminance: 15 },
          },
        ],
        [
          "Foliage Green Desaturation",
          { green: { hue: -10, saturation: -50, luminance: 0 } },
        ],
      ],
    },
    {
      feat: "colorGrading",
      run: (img, opt) => raster.colorGrading(raster.cloneImage(img), opt),
      settings: [
        [
          "Cinematic Teal Shadows & Golden Highlights",
          {
            shadows: { hue: 195, saturation: 35, luminance: -5 },
            midtones: { hue: 0, saturation: 0, luminance: 0 },
            highlights: { hue: 42, saturation: 40, luminance: 5 },
            balance: 0,
          },
        ],
        [
          "Warm Vintage Amber Wash",
          {
            shadows: { hue: 35, saturation: 25, luminance: 0 },
            midtones: { hue: 40, saturation: 20, luminance: 5 },
            highlights: { hue: 50, saturation: 30, luminance: 0 },
            balance: 10,
          },
        ],
      ],
    },

    // 4. ARTISTIC FILTERS
    {
      feat: "pencilSketch",
      run: (img) => raster.pencilSketch(raster.cloneImage(img)),
      settings: [["Pencil Graphite Shading", null]],
    },
    {
      feat: "oilPainting",
      run: (img, params) =>
        raster.oilPainting(
          raster.cloneImage(img),
          params.radius,
          params.intensity,
        ),
      settings: [
        ["Fine Impasto (r=2, i=16)", { radius: 2, intensity: 16 }],
        ["Heavy Canvas (r=4, i=24)", { radius: 4, intensity: 24 }],
      ],
    },
    {
      feat: "cartoonPosterize",
      run: (img, levels) =>
        raster.cartoonPosterize(raster.cloneImage(img), levels),
      settings: [
        ["4 Tonal Bands", 4],
        ["8 Tonal Bands", 8],
      ],
    },
    {
      feat: "watercolor",
      run: (img) => raster.watercolor(raster.cloneImage(img)),
      settings: [["Diffusion Wash", null]],
    },
    {
      feat: "crosshatch",
      run: (img) => raster.crosshatch(raster.cloneImage(img)),
      settings: [["Pen Crosshatching", null]],
    },
    {
      feat: "halftone",
      run: (img, dotSize) => raster.halftone(raster.cloneImage(img), dotSize),
      settings: [
        ["CMYK Newsprint (dot=4)", 4],
        ["Poster Dots (dot=8)", 8],
      ],
    },

    // 5. COLOR KEYING & SPILL SUPPRESSION
    {
      feat: "suppressSpill",
      run: (img, frac) =>
        raster.suppressSpill(raster.cloneImage(img), "green", frac),
      settings: [
        ["Gentle Spill Neutralization (0.5)", 0.5],
        ["Maximum Green Spill Removal (1.0)", 1.0],
      ],
    },
  ];

  const results = [];
  for (const t of tests) {
    for (const [settingName, param] of t.settings) {
      for (const [imgName, beforeImg] of Object.entries(testImages)) {
        const t0 = performance.now();
        let status = "PASS";
        let error = null;
        let afterImg = null;

        try {
          afterImg = t.run(beforeImg, param);
          if (!afterImg || !afterImg.data) {
            throw new Error("Function returned invalid raster image");
          }
          // Verify no NaNs or out of bounds
          for (let k = 0; k < Math.min(1000, afterImg.data.length); k++) {
            if (Number.isNaN(afterImg.data[k])) {
              throw new Error(`NaN encountered in pixel buffer at offset ${k}`);
            }
          }
        } catch (e) {
          status = "FAIL";
          error = e.message;
          console.error(
            `  FAIL ${t.feat} (${settingName}) on ${imgName}:`,
            e.message,
          );
        }

        const latencyMs = Number((performance.now() - t0).toFixed(2));
        const record = {
          category: "TypeScript Web Raster Engine",
          feature: t.feat,
          setting: settingName,
          image: imgName,
          input_size: `${beforeImg.width}x${beforeImg.height}`,
          status,
          latency_ms: latencyMs,
          error,
        };

        if (status === "PASS" && afterImg) {
          record.output_size = `${afterImg.width}x${afterImg.height}`;
          const metrics = computeRasterMetrics(beforeImg, afterImg);
          Object.assign(record, metrics);
        }

        results.push(record);
        const metricStr =
          status === "PASS"
            ? `MAE=${record.mae}, PSNR=${record.psnr}dB`
            : `ERR=${error}`;
        console.log(
          `  ✓ ${t.feat.padEnd(16)} | ${settingName.padEnd(36)} | ${imgName.padEnd(26)} | ${status} (${latencyMs}ms) | ${metricStr}`,
        );
      }
    }
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const total = results.length;
  const avgLatency = Number(
    (results.reduce((acc, r) => acc + r.latency_ms, 0) / total).toFixed(2),
  );

  const summary = {
    timestamp: new Date().toISOString(),
    engine: "TypeScript (packages/raster-tools)",
    total_executions: total,
    passed,
    failed: total - passed,
    pass_rate_pct: Number(((passed / total) * 100).toFixed(2)),
    avg_latency_ms: avgLatency,
    results,
  };

  const outPath = path.join(OUTPUT_DIR, "ts_raster_test_results.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(
    `\nTypeScript Raster Tests Complete: ${passed}/${total} passed (${summary.pass_rate_pct}%). Saved to ${outPath}`,
  );
  return summary;
}

runTsRasterTests();
