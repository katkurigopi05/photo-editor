import { z } from "zod";

/**
 * Keywords on an asset.
 *
 * Final Cut's keywords are how a large shoot becomes findable. Everything here
 * turns on one rule: "Interview", "interview" and " interview " are the same
 * keyword to a person, so they must be the same keyword to the filter. Without
 * that, a bin fills with near-duplicates that each match half the footage.
 *
 * Normalization happens at the UI boundary, not in the reducer: a command that
 * silently rewrote its own payload would not replay to the bytes it recorded,
 * so the schema *refuses* an unnormalized keyword rather than fixing it.
 */

const MAX_KEYWORD_LENGTH = 64;

/** The canonical form of a keyword, or null if the input is not one. */
export function normalizeKeyword(input: string): string | null {
  const folded = input.trim().replace(/\s+/g, " ").toLowerCase();
  if (folded === "" || folded.length > MAX_KEYWORD_LENGTH) return null;
  return folded;
}

const keywordSchema = z
  .string()
  .min(1)
  .max(MAX_KEYWORD_LENGTH)
  .refine((value) => normalizeKeyword(value) === value, {
    message:
      "keyword must be trimmed, lower case, and single-spaced (use normalizeKeyword)",
  });

export const assetKeywordsSchema = z
  .array(keywordSchema)
  .refine((list) => new Set(list).size === list.length, {
    message: "keywords must be unique",
  });

export type AssetKeywords = z.infer<typeof assetKeywordsSchema>;
