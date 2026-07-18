import type { z } from "zod";
import type { CommandError, CommandErrorCode } from "./types.js";

/** Build a typed domain error. Optional fields are omitted when absent so the
 * object stays JSON-native and canonical-serializable. */
export function makeError(
  code: CommandErrorCode,
  message: string,
  path?: Array<string | number>,
  details?: Record<string, unknown>,
): CommandError {
  const error: CommandError = { code, message };
  if (path !== undefined) error.path = path;
  if (details !== undefined) error.details = details;
  return error;
}

/** Convert a Zod failure into a `VALIDATION_ERROR`, reporting the first issue's
 * path and message so tests are deterministic. */
export function zodError(error: z.ZodError): CommandError {
  const first = error.issues[0];
  const message = first ? first.message : "validation failed";
  const path = first ? [...first.path] : [];
  return makeError("VALIDATION_ERROR", message, path, {
    issues: error.issues.map((issue) => ({
      path: [...issue.path],
      code: issue.code,
      message: issue.message,
    })),
  });
}
