/** Shared shaping of tool results. */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool results are text. JSON is the right text here: these payloads are
 * structured data an agent will read fields out of, and prose would force it
 * to parse ambiguity back into structure.
 */
export function asJson(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Truncates a long list, saying how much was withheld rather than leaving the
 * reader to guess whether they saw everything. */
export function capped<T>(
  items: readonly T[],
  limit: number,
): { items: T[]; total: number; truncated: boolean } {
  return {
    items: items.slice(0, limit),
    total: items.length,
    truncated: items.length > limit,
  };
}
