/**
 * UI skins — the *material* layer of the interface, orthogonal to the color
 * theme in theme.ts.
 *
 * A theme answers "what colors?"; a skin answers "what are the surfaces made
 * of?" — bevels, blur, elevation, radius, texture. A skin is applied by
 * setting `data-skin` on <html>; every rule lives in src/skins/*.css keyed off
 * that attribute, so skins compose with any theme and with dark/light.
 *
 * "default" removes the attribute and leaves the base index.css look intact.
 */

export interface SkinDefinition {
  id: string;
  label: string;
  /** One-line description, shown as the swatch tooltip. */
  blurb: string;
  /** CSS `background` for the picker swatch — a miniature of the skin. */
  preview: string;
}

export const SKINS: readonly SkinDefinition[] = [
  {
    id: "default",
    label: "Default",
    blurb: "The stock editor surface — flat panels, hairline borders",
    preview: "linear-gradient(135deg, var(--panel-2), var(--accent))",
  },
  {
    id: "skeuomorphism",
    label: "Skeuomorphic",
    blurb: "Beveled, tactile controls with real highlights and drop shadows",
    preview:
      "linear-gradient(180deg, #b9a888 0%, #8d7c5e 48%, #6d5f45 52%, #4a4132 100%)",
  },
  {
    id: "neumorphism",
    label: "Neumorphic",
    blurb: "Soft extruded monochrome — light and shadow, no borders",
    preview: "linear-gradient(135deg, #e9edf5 0%, #c3cbdb 60%, #aab3c6 100%)",
  },
  {
    id: "glassmorphism",
    label: "Glass",
    blurb: "Translucent frosted panels over a saturated backdrop",
    preview:
      "linear-gradient(135deg, rgba(255,255,255,0.55), rgba(120,160,255,0.35)), linear-gradient(45deg, #6a3df0, #23c3d6)",
  },
  {
    id: "claymorphism",
    label: "Clay",
    blurb: "Puffy pastel shapes with deep inner shadow",
    preview: "linear-gradient(135deg, #ffd3e2 0%, #c6b8ff 55%, #9ee5f5 100%)",
  },
  {
    id: "minimalism",
    label: "Minimal",
    blurb: "Type and space only — no shadow, no fill, one accent",
    preview: "linear-gradient(135deg, #fafafa 0%, #fafafa 78%, #111 78%)",
  },
  {
    id: "maximalism",
    label: "Maximal",
    blurb: "Loud gradients, hard offset shadows, thick ink borders",
    preview:
      "conic-gradient(from 210deg, #ff2e88, #ffbe0b, #06d6a0, #3a86ff, #ff2e88)",
  },
  {
    id: "liquid-glass",
    label: "Liquid Glass",
    blurb: "Heavy blur with specular edges and refracted highlights",
    preview:
      "radial-gradient(120% 90% at 25% 15%, rgba(255,255,255,0.85), rgba(255,255,255,0.05) 45%), linear-gradient(135deg, #2f6bff, #b14dff 60%, #17d4c4)",
  },
  {
    id: "spatial",
    label: "Spatial",
    blurb: "visionOS-style floating glass slabs with depth and lift",
    preview:
      "radial-gradient(90% 70% at 50% 0%, rgba(255,255,255,0.4), transparent 60%), linear-gradient(160deg, #2b3350, #0d1020)",
  },
] as const;

const SKIN_STORAGE_KEY = "director-skin";
const DEFAULT_SKIN = "default";

function isKnownSkin(id: string): boolean {
  return SKINS.some((s) => s.id === id);
}

export function currentSkin(): string {
  const stored = localStorage.getItem(SKIN_STORAGE_KEY);
  return stored !== null && isKnownSkin(stored) ? stored : DEFAULT_SKIN;
}

/** Set `data-skin` on <html> and persist. Unknown ids fall back to default. */
export function applySkin(id: string): void {
  const skin = isKnownSkin(id) ? id : DEFAULT_SKIN;
  const root = document.documentElement;
  if (skin === DEFAULT_SKIN) root.removeAttribute("data-skin");
  else root.setAttribute("data-skin", skin);
  localStorage.setItem(SKIN_STORAGE_KEY, skin);
}

export { SKIN_STORAGE_KEY, DEFAULT_SKIN };
