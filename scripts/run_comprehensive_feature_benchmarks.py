#!/usr/bin/env python3
"""Comprehensive feature test suite across all operations and settings.

Tests every image operation in core/, cv_tools/, and ai_tools/ across multiple
settings on diverse real-world images, measuring performance, mathematical delta
metrics (MAE, RMSE, PSNR, Luma Shift), and saving before/after visual proof.
"""
import os
import sys
import time
import json
import math
from PIL import Image, ImageOps, ImageDraw, ImageFilter, ImageStat
import numpy as np

# Ensure root workspace is on python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import core.operations as core_ops
import cv_tools.operations as cv_ops
try:
    import ai_tools.operations as ai_ops
except Exception as e:
    ai_ops = None
    print(f"ai_tools not imported: {e}")

TEST_IMAGES = {
    "lion_cub": "docs/assets/examples/lion-cub-before.jpg",
    "tiger_cub": "docs/assets/examples/tiger-cub-before.jpg",
    "color_chart": "test_media/photos/colour-chart-512x512.jpg",
    "detail_texture": "test_media/photos/detail-texture-1280x960.jpg",
}

import tempfile

DEFAULT_OUTPUT = os.path.join(tempfile.gettempdir(), "test_runs")
OUTPUT_DIR = os.environ.get("TEST_OUTPUT_DIR", DEFAULT_OUTPUT)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(os.path.join(OUTPUT_DIR, "panels"), exist_ok=True)

def compute_metrics(before_img: Image.Image, after_img: Image.Image):
    """Compute mathematical delta metrics between before and after images."""
    # Ensure same size and RGB mode for comparison
    if before_img.size != after_img.size:
        # For geometry ops (Resize, Crop), compare normalized thumbnails
        target_size = (300, 300)
        b_arr = np.array(before_img.convert("RGB").resize(target_size, Image.Resampling.BILINEAR), dtype=np.float64)
        a_arr = np.array(after_img.convert("RGB").resize(target_size, Image.Resampling.BILINEAR), dtype=np.float64)
    else:
        b_arr = np.array(before_img.convert("RGB"), dtype=np.float64)
        a_arr = np.array(after_img.convert("RGB"), dtype=np.float64)

    diff = np.abs(a_arr - b_arr)
    mae = float(np.mean(diff))
    mse = float(np.mean((a_arr - b_arr) ** 2))
    rmse = math.sqrt(mse)

    if mse == 0:
        psnr = 999.0  # Identical images
    else:
        psnr = float(20 * math.log10(255.0 / rmse))

    b_luma = float(np.mean(0.299 * b_arr[:, :, 0] + 0.587 * b_arr[:, :, 1] + 0.114 * b_arr[:, :, 2]))
    a_luma = float(np.mean(0.299 * a_arr[:, :, 0] + 0.587 * a_arr[:, :, 1] + 0.114 * a_arr[:, :, 2]))
    luma_shift = a_luma - b_luma

    b_std = float(np.std(b_arr))
    a_std = float(np.std(a_arr))
    contrast_shift = a_std - b_std

    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "psnr": round(psnr, 2),
        "before_luma": round(b_luma, 1),
        "after_luma": round(a_luma, 1),
        "luma_shift": round(luma_shift, 2),
        "contrast_shift": round(contrast_shift, 2),
    }

def generate_comparison_panel(before_img: Image.Image, after_img: Image.Image, label: str, out_path: str):
    """Generate side-by-side Before/After panel for verification."""
    # Standardize preview height to 400px
    h = 400
    b_w = int(before_img.width * (h / before_img.height))
    a_w = int(after_img.width * (h / after_img.height))
    b_scaled = before_img.convert("RGB").resize((b_w, h), Image.Resampling.BILINEAR)
    a_scaled = after_img.convert("RGB").resize((a_w, h), Image.Resampling.BILINEAR)

    panel = Image.new("RGB", (b_w + a_w, h + 40), (28, 30, 36))
    panel.paste(b_scaled, (0, 40))
    panel.paste(a_scaled, (b_w, 40))

    draw = ImageDraw.Draw(panel)
    # Header bar
    draw.text((15, 12), f"BEFORE  |  {label}", fill=(220, 225, 235))
    draw.text((b_w + 15, 12), "AFTER", fill=(0, 230, 160))

    # Divider line
    draw.line([(b_w, 40), (b_w, h + 40)], fill=(60, 65, 75), width=2)
    panel.save(out_path, "JPEG", quality=88)

def build_test_definitions():
    """Build full dictionary of all operations and all test setting variations."""
    tests = []

    # 1. TONE & EXPOSURE
    tests.append({
        "category": "Tone & Exposure",
        "feature": "Brightness",
        "settings": [
            ("Underexposed (-30%)", core_ops.Brightness(factor=0.7)),
            ("Subtle Lift (+15%)", core_ops.Brightness(factor=1.15)),
            ("High Lift (+60%)", core_ops.Brightness(factor=1.6)),
            ("Aggressive Max (+150%)", core_ops.Brightness(factor=2.5)),
        ]
    })
    tests.append({
        "category": "Tone & Exposure",
        "feature": "Contrast",
        "settings": [
            ("Flattened (-40%)", core_ops.Contrast(factor=0.6)),
            ("Moderate Punch (+20%)", core_ops.Contrast(factor=1.2)),
            ("High Dynamic Punch (+80%)", core_ops.Contrast(factor=1.8)),
        ]
    })
    tests.append({
        "category": "Tone & Exposure",
        "feature": "Highlights",
        "settings": [
            ("Extreme Recovery (-80)", core_ops.Highlights(amount=-80)),
            ("Gentle Roll-off (-25)", core_ops.Highlights(amount=-25)),
            ("Highlight Expansion (+50)", core_ops.Highlights(amount=50)),
        ]
    })
    tests.append({
        "category": "Tone & Exposure",
        "feature": "Shadows",
        "settings": [
            ("Crushed Shadows (-50)", core_ops.Shadows(amount=-50)),
            ("Gentle Shadow Lift (+30)", core_ops.Shadows(amount=30)),
            ("Maximum Detail Rescue (+85)", core_ops.Shadows(amount=85)),
        ]
    })
    tests.append({
        "category": "Tone & Exposure",
        "feature": "Curves",
        "settings": [
            ("S-Curve High Contrast", core_ops.Curves(points=[[0, 0], [64, 45], [192, 215], [255, 255]])),
            ("Lifted Matte Blacks", core_ops.Curves(points=[[0, 25], [70, 60], [185, 205], [255, 240]])),
            ("Warm Red Channel Boost", core_ops.Curves(points=[[0, 0], [128, 155], [255, 255]], channel="r")),
            ("Cool Blue Channel Boost", core_ops.Curves(points=[[0, 0], [128, 150], [255, 255]], channel="b")),
        ]
    })
    tests.append({
        "category": "Tone & Exposure",
        "feature": "Levels",
        "settings": [
            ("Standard Dynamic Range (15-240)", core_ops.Levels(black=15, white=240, gamma=1.0)),
            ("High Gamma Lift (γ=1.6)", core_ops.Levels(black=0, white=255, gamma=1.6)),
            ("Deep Compression (black=35, γ=0.8)", core_ops.Levels(black=35, white=255, gamma=0.8)),
        ]
    })
    tests.append({
        "category": "Tone & Exposure",
        "feature": "AutoContrast",
        "settings": [
            ("Minimal Cutoff (0.5%)", core_ops.AutoContrast(cutoff=0.5)),
            ("Default Cutoff (2.0%)", core_ops.AutoContrast(cutoff=2.0)),
            ("Aggressive Cutoff (5.0%)", core_ops.AutoContrast(cutoff=5.0)),
        ]
    })
    tests.append({
        "category": "Tone & Exposure",
        "feature": "Equalize",
        "settings": [
            ("Full Histogram Equalization", core_ops.Equalize()),
        ]
    })

    # 2. COLOR & WHITE BALANCE
    tests.append({
        "category": "Color & White Balance",
        "feature": "Temperature",
        "settings": [
            ("Cool Glacier Blue (-45)", core_ops.Temperature(amount=-45)),
            ("Warm Amber Golden Hour (+35)", core_ops.Temperature(amount=35)),
            ("Maximum Sunset Warmth (+75)", core_ops.Temperature(amount=75)),
        ]
    })
    tests.append({
        "category": "Color & White Balance",
        "feature": "Tint",
        "settings": [
            ("Green Neutralization (-40)", core_ops.Tint(amount=-40)),
            ("Magenta Creative Tint (+40)", core_ops.Tint(amount=40)),
        ]
    })
    tests.append({
        "category": "Color & White Balance",
        "feature": "Saturation",
        "settings": [
            ("Complete Monochrome (0.0x)", core_ops.Saturation(factor=0.0)),
            ("Muted Tones (0.6x)", core_ops.Saturation(factor=0.6)),
            ("Vibrant Saturation (1.4x)", core_ops.Saturation(factor=1.4)),
            ("Hyper-Saturated (2.2x)", core_ops.Saturation(factor=2.2)),
        ]
    })
    tests.append({
        "category": "Color & White Balance",
        "feature": "Vibrance",
        "settings": [
            ("Desaturated Non-Skin (-35)", core_ops.Vibrance(amount=-35)),
            ("Standard Vibrance (+30)", core_ops.Vibrance(amount=30)),
            ("Maximum Fur & Foliage (+75)", core_ops.Vibrance(amount=75)),
        ]
    })
    tests.append({
        "category": "Color & White Balance",
        "feature": "AutoWhiteBalance",
        "settings": [
            ("Gray World Neutralization", core_ops.AutoWhiteBalance()),
        ]
    })
    tests.append({
        "category": "Color & White Balance",
        "feature": "Grayscale",
        "settings": [
            ("Full Luminance Grayscale", core_ops.Grayscale()),
        ]
    })
    tests.append({
        "category": "Color & White Balance",
        "feature": "Sepia",
        "settings": [
            ("Photochemical Antique Sepia", core_ops.Sepia()),
        ]
    })
    tests.append({
        "category": "Color & White Balance",
        "feature": "Posterize",
        "settings": [
            ("2-Bit Graphic Posterization", core_ops.Posterize(bits=2)),
            ("4-Bit Retro Gamut", core_ops.Posterize(bits=4)),
        ]
    })
    tests.append({
        "category": "Color & White Balance",
        "feature": "Solarize",
        "settings": [
            ("Low Threshold (64)", core_ops.Solarize(threshold=64)),
            ("Midpoint Sabattier Effect (128)", core_ops.Solarize(threshold=128)),
            ("High Threshold (192)", core_ops.Solarize(threshold=192)),
        ]
    })

    # 3. SPATIAL, DETAIL & OPTICS
    tests.append({
        "category": "Spatial, Detail & Optics",
        "feature": "GaussianBlur",
        "settings": [
            ("Subtle Diffusion (r=2.0)", core_ops.GaussianBlur(radius=2.0)),
            ("Portrait Soft Focus (r=8.0)", core_ops.GaussianBlur(radius=8.0)),
            ("Deep Background Bokeh (r=25.0)", core_ops.GaussianBlur(radius=25.0)),
        ]
    })
    tests.append({
        "category": "Spatial, Detail & Optics",
        "feature": "Sharpen",
        "settings": [
            ("Micro-Contrast Accent (1.5x)", core_ops.Sharpen(factor=1.5)),
            ("Edge Definition (2.5x)", core_ops.Sharpen(factor=2.5)),
            ("Maximum Crisping (4.0x)", core_ops.Sharpen(factor=4.0)),
        ]
    })
    tests.append({
        "category": "Spatial, Detail & Optics",
        "feature": "Vignette",
        "settings": [
            ("Subtle Lens Falloff (+25)", core_ops.Vignette(amount=25)),
            ("Cinematic Vignette (+55)", core_ops.Vignette(amount=55)),
            ("High Drama Dark Perimeter (+85)", core_ops.Vignette(amount=85)),
            ("White Halo Negative Vignette (-45)", core_ops.Vignette(amount=-45)),
        ]
    })

    # 4. GEOMETRY & TRANSFORMS
    tests.append({
        "category": "Geometry & Transforms",
        "feature": "FlipHorizontal",
        "settings": [
            ("Mirror Reflection (Y-Axis)", core_ops.FlipHorizontal()),
        ]
    })
    tests.append({
        "category": "Geometry & Transforms",
        "feature": "FlipVertical",
        "settings": [
            ("Vertical Inversion (X-Axis)", core_ops.FlipVertical()),
        ]
    })
    tests.append({
        "category": "Geometry & Transforms",
        "feature": "Rotate90",
        "settings": [
            ("90-Degree Clockwise Turn", core_ops.Rotate90()),
        ]
    })
    tests.append({
        "category": "Geometry & Transforms",
        "feature": "Rotate",
        "settings": [
            ("Horizon Alignment (+3.5°)", core_ops.Rotate(angle=3.5, expand=False)),
            ("Creative Cant (+45°)", core_ops.Rotate(angle=45.0, expand=True)),
        ]
    })
    tests.append({
        "category": "Geometry & Transforms",
        "feature": "Crop",
        "settings": [
            ("Center Crop (25% Margins)", "DYNAMIC_CROP_CENTER"),
        ]
    })
    tests.append({
        "category": "Geometry & Transforms",
        "feature": "Resize",
        "settings": [
            ("Half Resolution Scale", "DYNAMIC_RESIZE_HALF"),
        ]
    })

    # 5. COMPUTER VISION TOOLS (OpenCV)
    tests.append({
        "category": "Computer Vision (OpenCV)",
        "feature": "CLAHE",
        "settings": [
            ("Subtle Local Contrast (clip=1.5, grid=8)", cv_ops.CLAHE(clip_limit=1.5, tile_grid=8)),
            ("High Definition Micro-Texture (clip=3.5, grid=16)", cv_ops.CLAHE(clip_limit=3.5, tile_grid=16)),
        ]
    })
    tests.append({
        "category": "Computer Vision (OpenCV)",
        "feature": "UnsharpMask",
        "settings": [
            ("Gentle Edge Crisp (r=1.2, amt=0.8)", cv_ops.UnsharpMask(radius=1.2, amount=0.8)),
            ("Deep Whiskers & Fur Punch (r=2.5, amt=1.8)", cv_ops.UnsharpMask(radius=2.5, amount=1.8)),
        ]
    })
    tests.append({
        "category": "Computer Vision (OpenCV)",
        "feature": "BilateralFilter",
        "settings": [
            ("Fine Skin Smoothing (d=7, σ=50)", cv_ops.BilateralFilter(diameter=7, sigma_color=50, sigma_space=50)),
            ("Painterly Edge-Preserve (d=15, σ=120)", cv_ops.BilateralFilter(diameter=15, sigma_color=120, sigma_space=120)),
        ]
    })
    tests.append({
        "category": "Computer Vision (OpenCV)",
        "feature": "Denoise",
        "settings": [
            ("Gentle Luminance Clean (str=6)", cv_ops.Denoise(strength=6, color_strength=6)),
            ("Aggressive High-ISO Denoise (str=18)", cv_ops.Denoise(strength=18, color_strength=18)),
        ]
    })
    tests.append({
        "category": "Computer Vision (OpenCV)",
        "feature": "RemoveObject (Inpaint)",
        "settings": [
            ("Telea Central Defect Inpainting", "DYNAMIC_INPAINT"),
        ]
    })

    # 6. AI TOOLS
    if ai_ops is not None:
        tests.append({
            "category": "AI Models & Neural Segmentation",
            "feature": "RemoveBackground",
            "settings": [
                ("RMBG-1.4 Neural Studio Cutout", ai_ops.RemoveBackground(model_name="briaai/RMBG-1.4")),
            ]
        })

    return tests

def run_all_tests():
    """Execute all tests across all images and setting combinations."""
    print("Starting Comprehensive Project Feature Test Suite...")
    print(f"Images to test: {list(TEST_IMAGES.keys())}")
    
    loaded_images = {}
    for name, path in TEST_IMAGES.items():
        if os.path.exists(path):
            loaded_images[name] = Image.open(path).convert("RGB")
            print(f"Loaded {name} ({loaded_images[name].size}, mode={loaded_images[name].mode})")
        else:
            print(f"WARNING: Image {path} not found!")

    test_defs = build_test_definitions()
    total_executions = sum(len(td["settings"]) * len(loaded_images) for td in test_defs)
    print(f"Total planned feature/setting executions: {total_executions}")

    results = []
    panel_index = 0

    for td in test_defs:
        category = td["category"]
        feature = td["feature"]
        print(f"\n[{category}] Testing {feature}...")

        for setting_name, op in td["settings"]:
            for img_name, before_img in loaded_images.items():
                w, h = before_img.size
                t0 = time.perf_counter()
                status = "PASS"
                error_msg = None
                after_img = None

                try:
                    # Handle dynamic operations that depend on image dimensions
                    if op == "DYNAMIC_CROP_CENTER":
                        dynamic_op = core_ops.Crop(
                            left=int(w * 0.2), top=int(h * 0.2),
                            right=int(w * 0.8), bottom=int(h * 0.8)
                        )
                        after_img = dynamic_op.apply(before_img)
                    elif op == "DYNAMIC_RESIZE_HALF":
                        dynamic_op = core_ops.Resize(width=w // 2, height=h // 2)
                        after_img = dynamic_op.apply(before_img)
                    elif op == "DYNAMIC_INPAINT":
                        dynamic_op = cv_ops.RemoveObject(
                            left=int(w * 0.45), top=int(h * 0.45),
                            right=int(w * 0.55), bottom=int(h * 0.55),
                            shape="rectangle", radius=5, method="telea"
                        )
                        after_img = dynamic_op.apply(before_img)
                    else:
                        after_img = op.apply(before_img)

                    # Validation checks
                    if after_img is None:
                        raise ValueError("apply() returned None")
                    if not isinstance(after_img, Image.Image):
                        raise TypeError(f"apply() returned unexpected type: {type(after_img)}")

                except Exception as e:
                    status = "FAIL"
                    error_msg = str(e)
                    print(f"  FAILED: {feature} ({setting_name}) on {img_name}: {e}")

                latency_ms = round((time.perf_counter() - t0) * 1000, 2)

                record = {
                    "category": category,
                    "feature": feature,
                    "setting": setting_name,
                    "image": img_name,
                    "input_size": f"{w}x{h}",
                    "status": status,
                    "latency_ms": latency_ms,
                    "error": error_msg,
                }

                if status == "PASS" and after_img is not None:
                    record["output_size"] = f"{after_img.width}x{after_img.height}"
                    record["output_mode"] = after_img.mode
                    metrics = compute_metrics(before_img, after_img)
                    record.update(metrics)

                    # Save visual sample panel for key representative combinations (first 2 images per setting)
                    if img_name in ("lion_cub", "colour_chart") and panel_index < 60:
                        safe_feat = feature.lower().replace(" ", "_").replace("&", "").replace("/", "_")
                        safe_set = setting_name.lower().replace(" ", "_").replace("(", "").replace(")", "").replace("%", "pct").replace("+", "p").replace("-", "m")
                        panel_filename = f"{panel_index:03d}_{safe_feat}_{safe_set}_{img_name}.jpg"
                        panel_path = os.path.join(OUTPUT_DIR, "panels", panel_filename)
                        generate_comparison_panel(before_img, after_img, f"{feature} - {setting_name}", panel_path)
                        record["panel_file"] = panel_filename
                        panel_index += 1

                results.append(record)
                metric_summary = f"MAE={record.get('mae', 'N/A')}, PSNR={record.get('psnr', 'N/A')}dB" if status == "PASS" else f"ERR={error_msg}"
                print(f"  ✓ {feature:18} | {setting_name:32} | {img_name:14} | {status} ({latency_ms:6.1f}ms) | {metric_summary}")

    # Summary statistics
    total = len(results)
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    avg_latency = round(sum(r["latency_ms"] for r in results if r["status"] == "PASS") / max(1, passed), 2)

    summary = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_executions": total,
        "passed": passed,
        "failed": failed,
        "pass_rate_pct": round((passed / total) * 100, 2),
        "avg_latency_ms": avg_latency,
        "tested_features_count": len(test_defs),
        "results": results
    }

    report_json_path = os.path.join(OUTPUT_DIR, "comprehensive_test_results.json")
    with open(report_json_path, "w") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 60)
    print(f"COMPREHENSIVE TEST RUN COMPLETE")
    print(f"Total Tests Executed: {total}")
    print(f"Passed: {passed} / {total} ({summary['pass_rate_pct']}%)")
    print(f"Failed: {failed}")
    print(f"Average Latency: {avg_latency} ms")
    print(f"Results saved to: {report_json_path}")
    print(f"Panels generated in: {os.path.join(OUTPUT_DIR, 'panels')}")
    print("=" * 60)
    return summary

if __name__ == "__main__":
    run_all_tests()
