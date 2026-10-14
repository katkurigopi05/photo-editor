import { createEditorState, type EditorState } from "@director/editor-state";

/**
 * Minimal, honest scaffold for the Project Director web client.
 *
 * Boots the shared, deterministic editor-state engine alongside modular
 * client subsystems.
 */
export function bootstrapWebEditor(): EditorState {
  return createEditorState();
}

export function describeWeb(): { app: string; status: "scaffold" } {
  return { app: "@director/web", status: "scaffold" };
}

// Re-export Canva-inspired client capabilities
export * from "./recording.js";
export * from "./eyedropper.js";
export * from "./tabs.js";
export * from "./downloads.js";
export * from "./memory-pressure.js";
export * from "./media-types.js";
export * from "./aspect-ratio.js";
export * from "./brand-kit.js";
export * from "./presentation.js";
export * from "./offline-sync.js";

// Re-export CapCut Pro-inspired audio and video capabilities
export * from "./beat-sync.js";
export * from "./color-match.js";
export * from "./auto-captions.js";
export * from "./vocal-isolation.js";
export * from "./deflicker.js";
export * from "./smart-cut.js";

// Re-export Adobe Lightroom-inspired photo editing & develop capabilities
export * from "./point-color.js";
export * from "./defringe.js";
export * from "./lens-correction.js";
export * from "./perspective-upright.js";
export * from "./xmp-preset.js";
export * from "./lens-blur.js";

