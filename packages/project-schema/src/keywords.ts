import { z } from "zod";
import { microsecondStringSchema } from "./primitives.js";

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

/** One keyword, in its canonical spelling. Exported because a keyword range
 * carries a single one and must obey exactly this rule, not a copy of it. */
export const keywordSchema = z
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

/**
 * A keyword over part of an asset — Final Cut's keyword range.
 *
 * The asset-level list above says "this shot is an interview". A range says
 * "seconds three to nine of it are the good take", which is the unit a long
 * take is actually searched by.
 *
 * Two decisions worth stating:
 *
 * - **The keyword obeys the same spelling rule.** A range reuses
 *   `keywordSchema` rather than a laxer one, or `Interview` over a range would
 *   filter as a different keyword from `interview` on the list.
 * - **Bounds are source-local microseconds**, the asset's own coordinate space
 *   — not a timeline position. A range is a fact about the media, so it stays
 *   true however many clips are cut from it, and however they are later moved.
 *
 * Half-open like every other range in the model: the end instant belongs to
 * whatever comes next. Whether a range *fits* the asset is the reducer's
 * business, since only it knows the asset's duration.
 */
export const assetKeywordRangeSchema = z
  .object({
    id: z.string().min(1),
    keyword: keywordSchema,
    /** Source-local microseconds, as canonical decimal strings. */
    startUs: microsecondStringSchema,
    endUs: microsecondStringSchema,
  })
  .strict()
  .refine((r) => isBeforeCanonical(r.startUs, r.endUs), {
    message: "endUs must be after startUs",
    path: ["endUs"],
  });

/**
 * Order two canonical nonnegative decimal strings: shorter is smaller, and
 * equal lengths compare lexicographically.
 *
 * Not `BigInt`, deliberately. Zod runs a `.refine` even when the object's own
 * members came back dirty, so this is handed values the regex has already
 * rejected — and `BigInt("3.5")` *throws*, which would surface a SyntaxError
 * from inside a `safeParse` that is supposed to return a result.
 */
function isBeforeCanonical(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length < b.length;
  return a < b;
}

export type AssetKeywordRange = z.infer<typeof assetKeywordRangeSchema>;

/**
 * Keyword ranges on one asset. Ids are unique so a command can name one.
 *
 * Overlap is allowed, and deliberately: two keywords over one stretch is
 * ordinary, and so is the same keyword twice where a take was marked in two
 * passes. Merging them here would rewrite the payload the command recorded,
 * which is the property replay rests on — a UI may offer to merge, the schema
 * does not do it behind the caller's back.
 */
export const assetKeywordRangesSchema = z
  .array(assetKeywordRangeSchema)
  .refine((ranges) => new Set(ranges.map((r) => r.id)).size === ranges.length, {
    message: "keyword range ids must be unique within an asset",
  });

export type AssetKeywordRanges = z.infer<typeof assetKeywordRangesSchema>;
