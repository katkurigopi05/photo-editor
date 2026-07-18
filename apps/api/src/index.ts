import { createEditorState, type EditorState } from "@director/editor-state";

/**
 * Minimal, honest scaffold for the Project Director API service.
 *
 * This foundation slice deliberately implements no HTTP transport, database, or
 * authentication. It exposes the in-process project-operation engine so a real
 * transport can be layered on later without changing the domain core.
 */
export interface ApiContext {
  state: EditorState;
}

/** Create an API context holding a fresh, empty editor state. */
export function createApiContext(): ApiContext {
  return { state: createEditorState() };
}

/** Describe what this scaffold currently provides. */
export function describeApi(): {
  service: string;
  status: "scaffold";
  capabilities: string[];
} {
  return {
    service: "@director/api",
    status: "scaffold",
    capabilities: ["in-process editor-state engine"],
  };
}
