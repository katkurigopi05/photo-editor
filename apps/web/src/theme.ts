/**
 * Customizable theme system: named presets plus user-defined custom themes
 * built from a handful of seed colors. Original design — CSS variable names
 * and derivation math only, no code or palette values borrowed from any
 * other project.
 *
 * A theme is a full override of the app's CSS custom properties, layered on
 * top of the base dark/light theme (see index.css) via inline styles on
 * <html>, which win the cascade over the [data-theme] rules. Selecting
 * "Default" clears the overrides and falls back to plain dark/light/system.
 */

export interface ThemeTokens {
  bg: string;
  bg2: string;
  panel: string;
  panel2: string;
  panel3: string;
  line: string;
  lineSoft: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accent2: string;
  onAccent: string;
  radialGlow: string;
  checker: string;
}

const TOKEN_TO_CSS_VAR: Record<keyof ThemeTokens, string> = {
  bg: "--bg",
  bg2: "--bg-2",
  panel: "--panel",
  panel2: "--panel-2",
  panel3: "--panel-3",
  line: "--line",
  lineSoft: "--line-soft",
  text: "--text",
  muted: "--muted",
  faint: "--faint",
  accent: "--accent",
  accent2: "--accent-2",
  onAccent: "--on-accent",
  radialGlow: "--radial-glow",
  checker: "--checker",
};

// ---- color math -------------------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Mix two hex colors; `amount` is the weight of `to` in [0, 1]. */
function mix(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rotate hue by `degrees` (approximate, via HSL round trip). Used to derive
 * a secondary accent from a single seed accent color. */
function rotateHue(hex: string, degrees: number): string {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return hex;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + degrees + 360) % 360;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [rr, gg, bb] = [0, 0, 0];
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return rgbToHex({ r: (rr + m) * 255, g: (gg + m) * 255, b: (bb + m) * 255 });
}

/** Derive a full token set from four seed colors (background, panel, text,
 * accent) by mixing — the same shape of input a user picks in the UI. */
export function deriveTheme(
  bg: string,
  panel: string,
  text: string,
  accent: string,
): ThemeTokens {
  const dark = relativeLuminance(bg) < 0.4;
  const edgeMix = dark ? "#ffffff" : "#000000";
  return {
    bg,
    bg2: mix(bg, dark ? "#000000" : "#ffffff", 0.35),
    panel,
    panel2: mix(panel, edgeMix, 0.06),
    panel3: mix(panel, edgeMix, 0.12),
    line: mix(panel, edgeMix, 0.22),
    lineSoft: mix(panel, edgeMix, 0.14),
    text,
    muted: mix(text, panel, 0.42),
    faint: mix(text, panel, 0.62),
    accent,
    accent2: rotateHue(accent, 45),
    onAccent: relativeLuminance(accent) > 0.5 ? "#12141a" : "#ffffff",
    radialGlow: mix(panel, accent, 0.18),
    checker: mix(bg, edgeMix, 0.06),
  };
}

// ---- presets ------------------------------------------------------------

export interface ThemeSeeds {
  bg: string;
  panel: string;
  text: string;
  accent: string;
}

/** A preset carries one palette per light/dark mode. Without both, selecting a
 * preset would pin the palette and leave the dark/light switch with nothing to
 * change — the inline overrides always beat the [data-theme] rules. */
export interface PresetDefinition {
  dark: ThemeSeeds;
  light: ThemeSeeds;
}

function seeds(
  bg: string,
  panel: string,
  text: string,
  accent: string,
): ThemeSeeds {
  return { bg, panel, text, accent };
}

/** Named preset themes, each a fully independent palette in both modes.
 * Original values; each pair keeps its hue family across modes. */
export const PRESETS: Record<string, PresetDefinition> = {
  nebula: {
    dark: seeds("#0c0e1a", "#171a2c", "#eceaf7", "#9b6bff"),
    light: seeds("#f2f0fb", "#ffffff", "#1b1830", "#6b34e0"),
  },
  ember: {
    dark: seeds("#1a1210", "#241815", "#f6ece4", "#ff7a45"),
    light: seeds("#fdf2ea", "#fffaf6", "#2b1a12", "#c2491a"),
  },
  pine: {
    dark: seeds("#0a1512", "#12211c", "#e6f2ec", "#35c98f"),
    light: seeds("#edf7f2", "#ffffff", "#0d241c", "#0a7d55"),
  },
  glacier: {
    dark: seeds("#0b1219", "#131d26", "#e6f1f8", "#3fb6e0"),
    light: seeds("#eef3f7", "#ffffff", "#16232c", "#0f7ba3"),
  },
  rosewood: {
    dark: seeds("#170d10", "#241419", "#f6e9ec", "#e8547e"),
    light: seeds("#fdf0f3", "#fffafb", "#2a121a", "#c01f52"),
  },
  sandstone: {
    dark: seeds("#16120c", "#221c13", "#f4ecdd", "#d98b39"),
    light: seeds("#f6efe2", "#fffaf1", "#3a2f22", "#9a5a16"),
  },
};

/** Tokens for a preset in the given mode, or null if the key is unknown. */
export function presetTokens(
  key: string,
  mode: "dark" | "light",
): ThemeTokens | null {
  const preset = PRESETS[key];
  if (!preset) return null;
  const s = preset[mode];
  return deriveTheme(s.bg, s.panel, s.text, s.accent);
}

/** Flip a hand-picked custom palette into the opposite mode: swap background
 * and text, and rebuild the panel a step away from the new background. The
 * accent is hue-carrying and stays put, so a custom theme keeps its identity
 * on both sides of the dark/light switch. */
export function counterpartSeeds(s: ThemeSeeds): ThemeSeeds {
  // The new background sits one small step darker/lighter than the new panel,
  // in whichever direction the flipped mode runs.
  const towardEdge = relativeLuminance(s.text) < 0.4 ? "#000000" : "#ffffff";
  return {
    bg: mix(s.text, towardEdge, 0.05),
    panel: s.text,
    text: s.bg,
    accent: s.accent,
  };
}

/** True when a palette's background is dark enough to belong to dark mode. */
export function seedsAreDark(s: ThemeSeeds): boolean {
  return relativeLuminance(s.bg) < 0.4;
}

export const PRESET_LABELS: Record<string, string> = {
  nebula: "Nebula",
  ember: "Ember",
  pine: "Pine",
  glacier: "Glacier",
  rosewood: "Rosewood",
  sandstone: "Sandstone",
};

// ---- apply ---------------------------------------------------------------

export function applyThemeTokens(tokens: ThemeTokens | null): void {
  const root = document.documentElement;
  if (tokens === null) {
    for (const cssVar of Object.values(TOKEN_TO_CSS_VAR)) {
      root.style.removeProperty(cssVar);
    }
    root.style.removeProperty("--accent-grad");
    return;
  }
  for (const key of Object.keys(TOKEN_TO_CSS_VAR) as (keyof ThemeTokens)[]) {
    root.style.setProperty(TOKEN_TO_CSS_VAR[key], tokens[key]);
  }
  root.style.setProperty(
    "--accent-grad",
    `linear-gradient(135deg, ${tokens.accent}, ${tokens.accent2})`,
  );
}

// ---- custom theme persistence --------------------------------------------

const CUSTOM_KEY = "director-custom-themes";
const MAX_CUSTOM_THEMES = 6;

export interface CustomThemeEntry {
  name: string;
  seeds: { bg: string; panel: string; text: string; accent: string };
}

export function loadCustomThemes(): CustomThemeEntry[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomThemeEntry[]) : [];
  } catch {
    return [];
  }
}

function saveCustomThemes(entries: CustomThemeEntry[]): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(entries));
}

/** Save/overwrite a custom theme by name. Returns false if the slot cap is
 * reached and `name` is not an existing entry. */
export function upsertCustomTheme(entry: CustomThemeEntry): boolean {
  const entries = loadCustomThemes();
  const idx = entries.findIndex((e) => e.name === entry.name);
  if (idx === -1) {
    if (entries.length >= MAX_CUSTOM_THEMES) return false;
    entries.push(entry);
  } else {
    entries[idx] = entry;
  }
  saveCustomThemes(entries);
  return true;
}

export function deleteCustomTheme(name: string): void {
  saveCustomThemes(loadCustomThemes().filter((e) => e.name !== name));
}

export { MAX_CUSTOM_THEMES };
