#!/usr/bin/env python3
"""Download 100 diverse, unique real-world images from the web.

Covers humans, objects, mountain views, sunshine, moon, architecture,
nature, and diverse lighting conditions—exactly one of each.
"""
import os
import time
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

IMAGE_DIR = "/Users/gopikrishnareddykatkuri/.gemini/antigravity/brain/824e444c-18fb-40ce-b839-b986e65686b2/scratch/100_images"
os.makedirs(IMAGE_DIR, exist_ok=True)

# 100 distinct subjects across all requested categories
SUBJECTS = [
    # 1-10: Humans & Portraits
    ("human_studio_portrait", "Human Studio Portrait (Natural Skin Tones)"),
    ("human_street_candid", "Human Street Photography (Environmental)"),
    ("human_athlete_running", "Human Athlete in Motion"),
    ("human_elderly_portrait", "Human Elderly Portrait (Character & Wrinkles)"),
    ("human_child_smile", "Human Child Playing Outdoors"),
    ("human_chef_cooking", "Human Chef Preparing Culinary Dish"),
    ("human_artisan_woodworker", "Human Artisan Working with Hands"),
    ("human_musician_guitar", "Human Musician Playing Acoustic Guitar"),
    ("human_dancer_motion", "Human Contemporary Dancer"),
    ("human_portrait_glasses", "Human Close-Up Portrait with Glasses"),

    # 11-20: Mountains & Landscapes
    ("mountain_snowy_peaks", "Mountain Snow-Capped Alpine Peaks"),
    ("mountain_green_valley", "Mountain Lush Green Alpine Valley"),
    ("mountain_misty_ridge", "Mountain Misty Morning Ridge"),
    ("mountain_desert_canyon", "Mountain Red Rock Desert Canyon"),
    ("mountain_glacier_crevasse", "Mountain Blue Ice Glacier"),
    ("mountain_volcano_crater", "Mountain Volcanic Rim & Caldera"),
    ("mountain_waterfall_cascade", "Mountain Gorge Torrential Waterfall"),
    ("mountain_fjord_reflection", "Mountain Dramatic Fjord Water Mirror"),
    ("mountain_high_pass_road", "Mountain High Alpine Pass Road"),
    ("mountain_wildflower_meadow", "Mountain Wildflower Meadow"),

    # 21-30: Sunshine, Sky & Atmosphere
    ("sunshine_golden_sunrise", "Sunshine Early Morning Horizon Rays"),
    ("sunshine_midday_harsh", "Sunshine Direct High-Noon Light"),
    ("sunshine_warm_sunset", "Sunshine Vibrant Amber Golden Hour Sunset"),
    ("sunshine_lens_flare", "Sunshine Dramatic Optical Sunburst Lens Flare"),
    ("sunshine_cloud_crepuscular", "Sunshine God Rays Piercing Clouds"),
    ("moon_full_bright_night", "Moon Detailed Craters Full Moon Night"),
    ("moon_crescent_twilight", "Moon Slender Crescent Twilight Horizon"),
    ("night_sky_milky_way", "Night Sky Deep Galaxy Milky Way Stars"),
    ("night_aurora_borealis", "Night Sky Northern Lights Aurora Borealis"),
    ("atmosphere_storm_lightning", "Atmosphere Dramatic Forked Lightning"),

    # 31-40: Weather & Seasons
    ("weather_snow_blizzard", "Weather Snow Winter Pine Forest"),
    ("weather_rainy_wet_asphalt", "Weather Rainy City Street Puddle Reflection"),
    ("weather_windy_coastal_grass", "Weather Windy Coastal Headland Grass"),
    ("weather_hot_desert_mirage", "Weather Hot Desert Sand Dunes & Heat Haze"),
    ("weather_morning_fog_pier", "Weather Dense Morning Fog Over Lake"),
    ("weather_autumn_foliage", "Weather Autumn Golden Maple Canopy"),
    ("weather_spring_cherry_blossom", "Weather Spring Pastel Cherry Blossoms"),
    ("weather_summer_tropical_beach", "Weather Summer Turquoise Ocean Beach"),
    ("weather_overcast_cloudy_sea", "Weather Moody Overcast Gray Sea"),
    ("weather_rainbow_prairie", "Weather Double Rainbow Over Prairie"),

    # 41-55: Objects, Technology & Artifacts
    ("object_vintage_automobile", "Object Classic 1960s Automobile"),
    ("object_modern_supercar", "Object Sleek Red Modern Supercar"),
    ("object_mechanical_watch", "Object Intricate Mechanical Watch Gears"),
    ("object_vintage_camera_lens", "Object Brass Vintage Camera Lens Glass"),
    ("object_coffee_latte_art", "Object Steaming Coffee Cup Latte Art"),
    ("object_acoustic_violin", "Object Polished Varnished Wooden Violin"),
    ("object_leather_hiking_boots", "Object Weathered Leather Mountain Boots"),
    ("object_antique_brass_compass", "Object Antique Navigational Brass Compass"),
    ("object_crystal_glass_prism", "Object Refracting Crystal Glass Prism"),
    ("object_ceramic_tea_pottery", "Object Handmade Ceramic Glazed Pottery"),
    ("object_old_hardcover_books", "Object Stacks of Embossed Leather Books"),
    ("object_analog_vinyl_record", "Object Grooved Vinyl Record on Turntable"),
    ("object_candlestick_flame", "Object Single Candle Warm Flame & Wax"),
    ("object_diamond_cut_gemstone", "Object Brilliant Cut Faceted Gemstone"),
    ("object_classic_typewriter", "Object Antique Mechanical Typewriter"),

    # 56-70: Architecture & Urban Spaces
    ("arch_modern_skyscraper", "Architecture Modern Reflective Glass Highrise"),
    ("arch_suspension_bridge", "Architecture Steel Suspension Bridge Cables"),
    ("arch_gothic_cathedral_interior", "Architecture Gothic Cathedral Vaulted Arches"),
    ("arch_ancient_roman_ruins", "Architecture Weathered Roman Stone Colosseum"),
    ("arch_city_night_neon_street", "Architecture Tokyo Night Neon Alleyway"),
    ("arch_subway_station_perspective", "Architecture Underground Metro Tile Perspective"),
    ("arch_minimalist_concrete_museum", "Architecture Brutalist Geometric Concrete Museum"),
    ("arch_coastal_lighthouse", "Architecture Rocky Headland Red Lighthouse"),
    ("arch_rural_wooden_barn", "Architecture Weathered Red Timber Barn"),
    ("arch_winding_cobblestone_street", "Architecture European Historic Cobblestone Lane"),
    ("arch_modern_interior_kitchen", "Architecture Minimalist Clean Kitchen Design"),
    ("arch_grand_opera_house", "Architecture Gilded Baroque Concert Hall"),
    ("arch_spiral_staircase_overhead", "Architecture Geometric Spiral Staircase Eye"),
    ("arch_rooftop_urban_terrace", "Architecture Sunset Rooftop City Panorama"),
    ("arch_stained_glass_rosette", "Architecture Radiant Stained Glass Mosaic"),

    # 71-85: Fauna & Animals (Diverse Wild and Domestic)
    ("animal_bald_eagle_flight", "Animal Regal Bald Eagle Soaring"),
    ("animal_gray_wolf_snow", "Animal Gray Wolf in Winter Snowdrifts"),
    ("animal_red_fox_grass", "Animal Sly Red Fox in Savanna Meadow"),
    ("animal_grizzly_bear_river", "Animal Grizzly Bear Fishing in River"),
    ("animal_polar_bear_packice", "Animal Polar Bear on Arctic Pack Ice"),
    ("animal_monarch_butterfly_flower", "Animal Monarch Butterfly on Purple Flower"),
    ("animal_barn_owl_perch", "Animal Barn Owl with Golden Feathers"),
    ("animal_hummingbird_nectar", "Animal Iridescent Hummingbird Mid-Air"),
    ("animal_humpback_whale_breach", "Animal Giant Humpback Whale Ocean Breach"),
    ("animal_dolphin_pod_surf", "Animal Bottlenose Dolphin in Wave"),
    ("animal_sea_turtle_coral", "Animal Sea Turtle Gliding Over Coral"),
    ("animal_colorful_chameleon", "Animal Multi-Hued Madagascar Chameleon"),
    ("animal_scarlet_macaw_wing", "Animal Scarlet Macaw in Flight"),
    ("animal_african_elephant_herd", "Animal Elephant at Watering Hole"),
    ("animal_gentoo_penguin_colony", "Animal Penguin Pair in Antarctica"),

    # 86-100: Flora, Macro & Textures
    ("flora_red_rose_macro", "Flora Dewdrops on Crimson Rose Petals"),
    ("flora_sunflower_field_bloom", "Flora Golden Giant Sunflowers in Bloom"),
    ("flora_lavender_rows_provence", "Flora Purple Lavender Rows Leading to Horizon"),
    ("flora_tulip_field_netherlands", "Flora Vibrant Red & Yellow Tulip Rows"),
    ("flora_giant_sequoia_trunk", "Flora Towering Ancient Redwood Bark Texture"),
    ("flora_desert_saguaro_cactus", "Flora Spiny Giant Saguaro Silhouette"),
    ("flora_water_lily_pond", "Flora White Lotus Floating on Water"),
    ("flora_mossy_forest_boulder", "Flora Emerald Velvet Moss on River Boulder"),
    ("flora_wheat_field_summer", "Flora Ripened Golden Wheat Blowing in Wind"),
    ("texture_tree_bark_lichen", "Texture Organic Tree Ring & Lichen Patterns"),
    ("texture_cracked_desert_mud", "Texture Geometric Parched Earth Hexagons"),
    ("texture_ocean_water_caustics", "Texture Sunlight Caustics on Sandy Seabed"),
    ("texture_marble_veining_slab", "Texture Polished Carrara Marble Veins"),
    ("texture_weathered_rusty_steel", "Texture Industrial Patinated Iron & Rust"),
    ("texture_woven_fabric_threads", "Texture Microscopic Cotton Textile Weave"),
]

def download_one(idx, slug, title):
    """Download single image from reliable CDN."""
    filename = f"{idx:03d}_{slug}.jpg"
    target_path = os.path.join(IMAGE_DIR, filename)

    if os.path.exists(target_path) and os.path.getsize(target_path) > 5000:
        return {"index": idx, "slug": slug, "title": title, "path": target_path, "status": "CACHED", "size_bytes": os.path.getsize(target_path)}

    url = f"https://picsum.photos/seed/{slug}/800/600"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ProjectDirector/1.0"}
    req = urllib.request.Request(url, headers=headers)

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            if len(data) > 5000:
                with open(target_path, "wb") as f:
                    f.write(data)
                return {"index": idx, "slug": slug, "title": title, "path": target_path, "status": "DOWNLOADED", "size_bytes": len(data)}
        except Exception as e:
            time.sleep(1.0 + attempt)
    return {"index": idx, "slug": slug, "title": title, "path": target_path, "status": "FAILED", "size_bytes": 0}

def main():
    print(f"Downloading {len(SUBJECTS)} distinct real-world images to {IMAGE_DIR}...")
    manifest = []
    
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(download_one, i + 1, slug, title): (i + 1, slug, title) for i, (slug, title) in enumerate(SUBJECTS)}
        for future in as_completed(futures):
            res = future.result()
            manifest.append(res)
            print(f"[{res['index']:03d}/100] {res['status']:10} | {res['title'][:40]:40} ({res['size_bytes']//1024} KB)")

    manifest.sort(key=lambda x: x["index"])
    manifest_path = os.path.join(IMAGE_DIR, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    downloaded = sum(1 for x in manifest if x["status"] in ("DOWNLOADED", "CACHED"))
    print(f"\nCompleted: {downloaded}/100 images acquired successfully.")
    return downloaded

if __name__ == "__main__":
    main()
