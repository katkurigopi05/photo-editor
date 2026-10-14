/**
 * Adobe Lightroom XMP Develop Preset Parser and Exporter.
 *
 * Implements bidirectional reading and writing of standardized Adobe Camera Raw
 * (.xmp) develop presets, enabling photographers to import, apply, and export
 * industry-standard preset files.
 */

export interface XmpDevelopSettings {
  presetName?: string | undefined;
  uuid?: string | undefined;

  // Basic Tone (Process Version 2012+)
  exposure2012?: number | undefined;
  contrast2012?: number | undefined;
  highlights2012?: number | undefined;
  shadows2012?: number | undefined;
  whites2012?: number | undefined;
  blacks2012?: number | undefined;

  // Presence & Detail
  texture?: number | undefined;
  clarity2012?: number | undefined;
  dehaze?: number | undefined;
  vibrance?: number | undefined;
  saturation?: number | undefined;

  // White Balance
  temperature?: number | undefined;
  tint?: number | undefined;

  // Detail & Optics
  sharpness?: number | undefined;
  luminanceSmoothing?: number | undefined;
  colorNoiseReduction?: number | undefined;
  defringePurpleAmount?: number | undefined;
  defringeGreenAmount?: number | undefined;
  lensManualDistortionAmount?: number | undefined;
}

/**
 * Extracts attribute or tag value from XML string with lenient fallback.
 */
function extractXmlValue(xml: string, tag: string): string | undefined {
  // Check attribute format: crs:Tag="value" or crs:Tag='value'
  const attrRegex = new RegExp(`crs:${tag}\\s*=\\s*["']([^"']+)["']`, "i");
  const attrMatch = xml.match(attrRegex);
  if (attrMatch?.[1] !== undefined) {
    return attrMatch[1];
  }

  // Check element format: <crs:Tag>value</crs:Tag>
  const elemRegex = new RegExp(`<crs:${tag}[^>]*>([\\s\\S]*?)<\\/crs:${tag}>`, "i");
  const elemMatch = xml.match(elemRegex);
  if (elemMatch?.[1] !== undefined) {
    return elemMatch[1].trim();
  }

  return undefined;
}

function parseNumber(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const num = parseFloat(val);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Parses an Adobe Lightroom .xmp preset XML string into typed develop settings.
 */
export function parseXmpPreset(xml: string): XmpDevelopSettings {
  const presetName =
    extractXmlValue(xml, "PresetName") ??
    extractXmlValue(xml, "Name") ??
    "Untitled Preset";

  const uuid = extractXmlValue(xml, "UUID");

  return {
    presetName,
    uuid,
    exposure2012: parseNumber(extractXmlValue(xml, "Exposure2012")),
    contrast2012: parseNumber(extractXmlValue(xml, "Contrast2012")),
    highlights2012: parseNumber(extractXmlValue(xml, "Highlights2012")),
    shadows2012: parseNumber(extractXmlValue(xml, "Shadows2012")),
    whites2012: parseNumber(extractXmlValue(xml, "Whites2012")),
    blacks2012: parseNumber(extractXmlValue(xml, "Blacks2012")),
    texture: parseNumber(extractXmlValue(xml, "Texture")),
    clarity2012: parseNumber(extractXmlValue(xml, "Clarity2012")),
    dehaze: parseNumber(extractXmlValue(xml, "Dehaze")),
    vibrance: parseNumber(extractXmlValue(xml, "Vibrance")),
    saturation: parseNumber(extractXmlValue(xml, "Saturation")),
    temperature: parseNumber(extractXmlValue(xml, "Temperature")),
    tint: parseNumber(extractXmlValue(xml, "Tint")),
    sharpness: parseNumber(extractXmlValue(xml, "Sharpness")),
    luminanceSmoothing: parseNumber(extractXmlValue(xml, "LuminanceSmoothing")),
    colorNoiseReduction: parseNumber(extractXmlValue(xml, "ColorNoiseReduction")),
    defringePurpleAmount: parseNumber(extractXmlValue(xml, "DefringePurpleAmount")),
    defringeGreenAmount: parseNumber(extractXmlValue(xml, "DefringeGreenAmount")),
    lensManualDistortionAmount: parseNumber(extractXmlValue(xml, "LensManualDistortionAmount")),
  };
}

/**
 * Serializes develop settings into standard Adobe XMP XML.
 */
export function exportXmpPreset(settings: XmpDevelopSettings): string {
  const name = settings.presetName ?? "Project Director Preset";
  const attrs: string[] = [
    `crs:PresetName="${name}"`,
    `crs:ProcessVersion="15.4"`,
    `crs:HasSettings="True"`,
  ];

  if (settings.uuid) attrs.push(`crs:UUID="${settings.uuid}"`);
  if (settings.exposure2012 !== undefined) attrs.push(`crs:Exposure2012="${settings.exposure2012.toFixed(2)}"`);
  if (settings.contrast2012 !== undefined) attrs.push(`crs:Contrast2012="${Math.round(settings.contrast2012)}"`);
  if (settings.highlights2012 !== undefined) attrs.push(`crs:Highlights2012="${Math.round(settings.highlights2012)}"`);
  if (settings.shadows2012 !== undefined) attrs.push(`crs:Shadows2012="${Math.round(settings.shadows2012)}"`);
  if (settings.whites2012 !== undefined) attrs.push(`crs:Whites2012="${Math.round(settings.whites2012)}"`);
  if (settings.blacks2012 !== undefined) attrs.push(`crs:Blacks2012="${Math.round(settings.blacks2012)}"`);
  if (settings.texture !== undefined) attrs.push(`crs:Texture="${Math.round(settings.texture)}"`);
  if (settings.clarity2012 !== undefined) attrs.push(`crs:Clarity2012="${Math.round(settings.clarity2012)}"`);
  if (settings.dehaze !== undefined) attrs.push(`crs:Dehaze="${Math.round(settings.dehaze)}"`);
  if (settings.vibrance !== undefined) attrs.push(`crs:Vibrance="${Math.round(settings.vibrance)}"`);
  if (settings.saturation !== undefined) attrs.push(`crs:Saturation="${Math.round(settings.saturation)}"`);
  if (settings.temperature !== undefined) attrs.push(`crs:Temperature="${Math.round(settings.temperature)}"`);
  if (settings.tint !== undefined) attrs.push(`crs:Tint="${Math.round(settings.tint)}"`);
  if (settings.sharpness !== undefined) attrs.push(`crs:Sharpness="${Math.round(settings.sharpness)}"`);
  if (settings.luminanceSmoothing !== undefined) attrs.push(`crs:LuminanceSmoothing="${Math.round(settings.luminanceSmoothing)}"`);
  if (settings.colorNoiseReduction !== undefined) attrs.push(`crs:ColorNoiseReduction="${Math.round(settings.colorNoiseReduction)}"`);

  const attrStr = attrs.map((a) => `    ${a}`).join("\n");

  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
${attrStr}>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;
}
