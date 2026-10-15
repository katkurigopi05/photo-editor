#!/usr/bin/env python3
"""Generate Before & After comparison panels for ALL 100 tested images.

Saves 100 individual high-resolution side-by-side verification panels to
/Users/gopikrishnareddykatkuri/.gemini/antigravity/brain/824e444c-18fb-40ce-b839-b986e65686b2/test_panels_100/
and generates structured markdown embeds for every single image.
"""
import os
import sys
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import core.operations as core_ops
import cv_tools.operations as cv_ops

import tempfile

DEFAULT_BASE = os.path.join(tempfile.gettempdir(), "test_runs_100")
IMAGE_DIR = os.environ.get("IMAGE_DIR", os.path.join(DEFAULT_BASE, "100_images"))
PANEL_DIR = os.environ.get("PANEL_DIR", os.path.join(DEFAULT_BASE, "test_panels_100"))
os.makedirs(PANEL_DIR, exist_ok=True)

def apply_full_pipeline(orig_img: Image.Image, weather: str, tod: str, mode: str, idx: int) -> Image.Image:
    """Apply the complete multi-feature editing pipeline to the image."""
    res = orig_img.copy()

    # 1. Base Photo Editing: Lightroom tone + curves + CLAHE + unsharp mask
    res = core_ops.Highlights(amount=-25).apply(res)
    res = core_ops.Shadows(amount=30).apply(res)
    res = core_ops.Vibrance(amount=35).apply(res)
    res = core_ops.Curves(points=[[0, 8], [65, 52], [190, 215], [255, 250]]).apply(res)
    res = cv_ops.CLAHE(clip_limit=1.6, tile_grid=8).apply(res)
    res = cv_ops.UnsharpMask(radius=1.2, amount=0.7).apply(res)

    # 2. Weather simulation
    w, h = res.size
    if weather == "snow":
        res = core_ops.Temperature(amount=-35).apply(res)
        res = core_ops.Brightness(factor=1.12).apply(res)
        snow_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(snow_layer)
        np.random.seed(idx * 7)
        for _ in range(200):
            sx, sy = np.random.randint(0, w), np.random.randint(0, h)
            sr = np.random.randint(1, 4)
            draw.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(255, 255, 255, 180))
        snow_layer = snow_layer.filter(ImageFilter.GaussianBlur(radius=1.0))
        res = Image.alpha_composite(res.convert("RGBA"), snow_layer).convert("RGB")

    elif weather == "hot":
        res = core_ops.Temperature(amount=45).apply(res)
        res = core_ops.Vibrance(amount=40).apply(res)
        res = core_ops.Contrast(factor=1.2).apply(res)

    elif weather == "rainy":
        res = core_ops.Temperature(amount=-18).apply(res)
        res = core_ops.Saturation(factor=0.8).apply(res)
        rain_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(rain_layer)
        np.random.seed(idx * 11)
        for _ in range(250):
            rx, ry = np.random.randint(0, w), np.random.randint(0, h)
            draw.line([(rx, ry), (rx - 3, ry + 18)], fill=(220, 230, 245, 110), width=1)
        rain_layer = rain_layer.filter(ImageFilter.GaussianBlur(radius=0.5))
        res = Image.alpha_composite(res.convert("RGBA"), rain_layer).convert("RGB")

    elif weather == "windy":
        res = cv_ops.UnsharpMask(radius=2.2, amount=1.3).apply(res)
        res = core_ops.Contrast(factor=1.18).apply(res)

    # 3. Time of day lighting
    if tod == "morning":
        res = core_ops.Temperature(amount=20).apply(res)
        res = core_ops.Tint(amount=15).apply(res)
        res = core_ops.Shadows(amount=25).apply(res)
    elif tod == "afternoon":
        res = core_ops.Brightness(factor=1.06).apply(res)
        res = core_ops.Contrast(factor=1.15).apply(res)
    elif tod == "evening":
        res = core_ops.Temperature(amount=42).apply(res)
        res = core_ops.Vibrance(amount=45).apply(res)
        res = core_ops.Vignette(amount=30).apply(res)
    elif tod == "night":
        res = core_ops.Brightness(factor=0.68).apply(res)
        res = core_ops.Temperature(amount=-40).apply(res)
        res = core_ops.Vignette(amount=55).apply(res)

    return res

def compute_metrics(before_img: Image.Image, after_img: Image.Image):
    b_arr = np.array(before_img.convert("RGB"), dtype=np.float64)
    a_arr = np.array(after_img.convert("RGB"), dtype=np.float64)
    diff = np.abs(a_arr - b_arr)
    mae = float(np.mean(diff))
    mse = float(np.mean((a_arr - b_arr) ** 2))
    psnr = 999.0 if mse == 0 else float(20 * math.log10(255.0 / math.sqrt(mse)))
    b_luma = float(np.mean(0.299 * b_arr[:, :, 0] + 0.587 * b_arr[:, :, 1] + 0.114 * b_arr[:, :, 2]))
    a_luma = float(np.mean(0.299 * a_arr[:, :, 0] + 0.587 * a_arr[:, :, 1] + 0.114 * a_arr[:, :, 2]))
    return {
        "mae": round(mae, 1),
        "psnr": round(psnr, 1),
        "luma_shift": round(a_luma - b_luma, 1),
    }

def main():
    manifest_path = os.path.join(IMAGE_DIR, "manifest.json")
    with open(manifest_path) as f:
        manifest = json.load(f)

    weathers = ["snow", "hot", "rainy", "windy"]
    tods = ["morning", "afternoon", "evening", "night"]
    modes = ["Photo Editing", "Video Editing", "Animation Mode", "GIF Mode"]

    panels_meta = []
    print(f"Generating side-by-side Before/After panels for all {len(manifest)} images...")

    for i, item in enumerate(manifest):
        idx = item["index"]
        slug = item["slug"]
        title = item["title"]
        img_path = item["path"]

        cur_weather = weathers[i % len(weathers)]
        cur_tod = tods[(i // len(weathers)) % len(tods)]
        cur_mode = modes[i % len(modes)]

        orig_img = Image.open(img_path).convert("RGB")
        after_img = apply_full_pipeline(orig_img, cur_weather, cur_tod, cur_mode, idx)
        metrics = compute_metrics(orig_img, after_img)

        # Build clean side-by-side panel
        h = 320
        b_w = int(orig_img.width * (h / orig_img.height))
        a_w = int(after_img.width * (h / after_img.height))
        b_scaled = orig_img.resize((b_w, h), Image.Resampling.BILINEAR)
        a_scaled = after_img.resize((a_w, h), Image.Resampling.BILINEAR)

        panel = Image.new("RGB", (b_w + a_w, h + 32), (24, 26, 32))
        panel.paste(b_scaled, (0, 32))
        panel.paste(a_scaled, (b_w, 32))

        draw = ImageDraw.Draw(panel)
        draw.text((10, 8), f"BEFORE | #{idx:03d} {title[:28]}", fill=(215, 220, 230))
        draw.text((b_w + 10, 8), f"AFTER [{cur_weather.upper()}, {cur_tod.upper()}]", fill=(0, 230, 160))
        draw.line([(b_w, 32), (b_w, h + 32)], fill=(50, 55, 65), width=2)

        panel_filename = f"panel_{idx:03d}_{slug}.jpg"
        panel_path = os.path.join(PANEL_DIR, panel_filename)
        panel.save(panel_path, "JPEG", quality=85)

        panels_meta.append({
            "index": idx,
            "slug": slug,
            "title": title,
            "weather": cur_weather,
            "time_of_day": cur_tod,
            "mode": cur_mode,
            "panel_file": panel_filename,
            "panel_path": panel_path,
            **metrics
        })

        if idx % 10 == 0 or idx == 100:
            print(f"Generated {idx}/100 panels (MAE={metrics['mae']}, PSNR={metrics['psnr']}dB)")

    meta_file = os.path.join(PANEL_DIR, "all_100_panels_metadata.json")
    with open(meta_file, "w") as f:
        json.dump(panels_meta, f, indent=2)

    print(f"\nSuccessfully generated ALL 100 verification panels in {PANEL_DIR}!")

if __name__ == "__main__":
    main()
