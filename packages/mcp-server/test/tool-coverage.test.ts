import { describe, expect, test } from "vitest";
import { PUBLIC_COMMAND_TYPES } from "@director/command-schema";
import { EDIT_TOOL_COMMAND_TYPES, EDIT_TOOL_NAMES } from "../src/tools/edit.js";

/**
 * The MCP server must expose every command the engine accepts.
 *
 * This existed as an unchecked assumption until a review found the server
 * advertising tools for 15 of 20 commands: add_keyframe, update_keyframe,
 * remove_keyframe, update_clip_animations and set_clip_transition had none, so
 * an agent could add effects and move clips but could not animate anything or
 * place a transition.
 *
 * Each tool's *input schema* is the command's payload schema, so a command that
 * gains a field gains it in the tool for free. A wholly new command does not —
 * it needs an entry in COMMAND_TOOLS, and nothing but this test notices when
 * one is missing.
 */
describe("MCP edit tool coverage", () => {
  test("every public command is exposed as a tool", () => {
    const missing = PUBLIC_COMMAND_TYPES.filter(
      (command) => !EDIT_TOOL_COMMAND_TYPES.includes(command),
    );
    expect(
      missing,
      `commands with no MCP tool: ${missing.join(", ") || "none"}`,
    ).toEqual([]);
  });

  test("no tool claims a command the engine does not accept", () => {
    // The other direction: a tool dispatching an unknown commandType would be
    // rejected at runtime with "unknown command type" and nowhere else.
    const unknown = EDIT_TOOL_COMMAND_TYPES.filter(
      (command) =>
        !(PUBLIC_COMMAND_TYPES as readonly string[]).includes(command),
    );
    expect(
      unknown,
      `tools referencing no such command: ${unknown.join(", ") || "none"}`,
    ).toEqual([]);
  });

  test("the mapping is one tool per command", () => {
    expect(EDIT_TOOL_COMMAND_TYPES.length).toBe(PUBLIC_COMMAND_TYPES.length);
    expect(new Set(EDIT_TOOL_COMMAND_TYPES).size).toBe(
      EDIT_TOOL_COMMAND_TYPES.length,
    );
  });

  test("tool names are unique", () => {
    // Registering two tools under one name silently shadows the first.
    expect(new Set(EDIT_TOOL_NAMES).size).toBe(EDIT_TOOL_NAMES.length);
  });

  test("tool names are snake_case, matching the rest of the surface", () => {
    const odd = EDIT_TOOL_NAMES.filter(
      (name) => !/^[a-z][a-z0-9_]*$/.test(name),
    );
    expect(odd, `unexpected tool names: ${odd.join(", ")}`).toEqual([]);
  });
});
