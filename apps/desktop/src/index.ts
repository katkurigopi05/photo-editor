import { createEditorState, type EditorState } from "@director/editor-state";

/**
 * Minimal, honest scaffold for the Project Director desktop client.
 *
 * No native shell, rendering, or media I/O is implemented in this foundation
 * slice. The scaffold boots the shared, deterministic editor-state engine.
 */
export function bootstrapDesktopEditor(): EditorState {
  return createEditorState();
}

export function describeDesktop(): { app: string; status: "scaffold" } {
  return { app: "@director/desktop", status: "scaffold" };
}
