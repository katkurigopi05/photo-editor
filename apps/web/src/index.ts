import { createEditorState, type EditorState } from "@director/editor-state";

/**
 * Minimal, honest scaffold for the Project Director web client.
 *
 * No rendering, playback, or media decoding is implemented in this foundation
 * slice. The scaffold boots the shared, deterministic editor-state engine so UI
 * layers can be added later against a stable domain core.
 */
export function bootstrapWebEditor(): EditorState {
  return createEditorState();
}

export function describeWeb(): { app: string; status: "scaffold" } {
  return { app: "@director/web", status: "scaffold" };
}
