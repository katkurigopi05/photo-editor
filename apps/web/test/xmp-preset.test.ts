import { describe, expect, it } from "vitest";
import { exportXmpPreset, parseXmpPreset } from "../src/xmp-preset.js";

describe("Adobe Lightroom XMP Preset Engine", () => {
  it("parses Lightroom .xmp XML into develop settings", () => {
    const sampleXml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:PresetName="Moody Golden Hour"
      crs:Exposure2012="+0.75"
      crs:Contrast2012="+25"
      crs:Highlights2012="-40"
      crs:Shadows2012="+30"
      crs:Whites2012="+10"
      crs:Blacks2012="-15"
      crs:Texture="+20"
      crs:Clarity2012="+15"
      crs:Dehaze="+10"
      crs:Temperature="+5500"
      crs:Tint="+12">
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

    const parsed = parseXmpPreset(sampleXml);
    expect(parsed.presetName).toBe("Moody Golden Hour");
    expect(parsed.exposure2012).toBe(0.75);
    expect(parsed.contrast2012).toBe(25);
    expect(parsed.highlights2012).toBe(-40);
    expect(parsed.shadows2012).toBe(30);
    expect(parsed.whites2012).toBe(10);
    expect(parsed.blacks2012).toBe(-15);
    expect(parsed.texture).toBe(20);
    expect(parsed.clarity2012).toBe(15);
    expect(parsed.dehaze).toBe(10);
    expect(parsed.temperature).toBe(5500);
    expect(parsed.tint).toBe(12);
  });

  it("exports develop settings to valid Adobe XMP XML and round-trips correctly", () => {
    const originalSettings = {
      presetName: "Cinematic Teal & Orange",
      exposure2012: 0.35,
      contrast2012: 18,
      highlights2012: -25,
      shadows2012: 20,
      whites2012: 5,
      blacks2012: -10,
      texture: 15,
      clarity2012: 12,
      dehaze: 8,
      vibrance: 25,
      saturation: -5,
    };

    const exportedXml = exportXmpPreset(originalSettings);
    expect(exportedXml).toContain('xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"');
    expect(exportedXml).toContain('crs:PresetName="Cinematic Teal & Orange"');
    expect(exportedXml).toContain('crs:Exposure2012="0.35"');

    const reimported = parseXmpPreset(exportedXml);
    expect(reimported.presetName).toBe("Cinematic Teal & Orange");
    expect(reimported.exposure2012).toBeCloseTo(0.35, 2);
    expect(reimported.contrast2012).toBe(18);
    expect(reimported.highlights2012).toBe(-25);
    expect(reimported.shadows2012).toBe(20);
    expect(reimported.texture).toBe(15);
  });
});
