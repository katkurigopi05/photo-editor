import { z } from "zod";
import {
  projectOperationSchema,
  type ProjectOperation,
} from "@director/command-schema";

/**
 * The project file.
 *
 * The operation log *is* the project: replaying it reconstructs the state
 * byte-for-byte, which the engine already guarantees. So a saved file is that
 * log plus enough about the media to find it again.
 *
 * Media cannot be saved by reference the way a desktop app would. A browser
 * knows a `File` only through an opaque `blob:` URL that dies with the tab, and
 * never learns its path. So the file stores a *hint* per asset — name, size,
 * checksum — and opening a project matches those hints against files the user
 * picks. That is why relinking is part of opening rather than an error state.
 */

export const PROJECT_FILE_FORMAT = "project-director.project";
export const PROJECT_FILE_VERSION = 1;

/** What is remembered about one asset so its file can be found again. */
export const mediaHintSchema = z
  .object({
    assetId: z.string().min(1),
    name: z.string().min(1),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
    fileSizeBytes: z.string().regex(/^(0|[1-9][0-9]*)$/),
    kind: z.enum(["image", "video", "audio", "generated"]),
  })
  .strict();

export type MediaHint = z.infer<typeof mediaHintSchema>;

/**
 * The save file's shape, written out rather than inferred.
 *
 * `operations` holds `ProjectOperation`, whose command is a union over every
 * public command — and that union is now large enough that TypeScript refuses
 * to serialize the inferred type of this schema at all ("exceeds the maximum
 * length the compiler will serialize"). Declaring the type and annotating the
 * schema with it keeps the checker's work bounded, and the schema still
 * validates exactly what it did.
 */
export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  formatVersion: number;
  savedAt: string;
  /** How many leading operations are app scaffolding — the project, sequence
   * and tracks created at boot. Undo stops here, in this session and in any
   * session that opens the file. */
  baseline: number;
  operations: ProjectOperation[];
  media: MediaHint[];
}

export const projectFileSchema: z.ZodType<ProjectFile> = z
  .object({
    format: z.literal(PROJECT_FILE_FORMAT),
    formatVersion: z.number().int().positive(),
    savedAt: z.string().min(1),
    baseline: z.number().int().nonnegative(),
    operations: z.array(projectOperationSchema),
    media: z.array(mediaHintSchema),
  })
  .strict();

export type ParseResult =
  | { ok: true; file: ProjectFile }
  | { ok: false; error: string };

export function buildProjectFile(
  operations: readonly unknown[],
  media: readonly MediaHint[],
  savedAt: string,
  baseline = 0,
): ProjectFile {
  return projectFileSchema.parse({
    format: PROJECT_FILE_FORMAT,
    formatVersion: PROJECT_FILE_VERSION,
    savedAt,
    baseline,
    operations,
    media,
  });
}

/** Pretty-printed rather than canonical: a project file is something a person
 * may open in an editor or put under version control, and the engine's
 * byte-equality guarantees are about the operations, not about this wrapper. */
export function serializeProjectFile(file: ProjectFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseProjectFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }

  // Check the envelope before the operations, so a wrong file type is reported
  // as a wrong file type rather than as a hundred schema issues.
  const envelope = z.object({ format: z.unknown(), formatVersion: z.unknown() });
  const shallow = envelope.safeParse(raw);
  if (!shallow.success || shallow.data.format !== PROJECT_FILE_FORMAT) {
    return { ok: false, error: "That is not a Project Director project file." };
  }
  if (
    typeof shallow.data.formatVersion === "number" &&
    shallow.data.formatVersion > PROJECT_FILE_VERSION
  ) {
    return {
      ok: false,
      error: `That project was written by a newer version (format ${shallow.data.formatVersion}); this build reads up to ${PROJECT_FILE_VERSION}.`,
    };
  }

  const parsed = projectFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `The project file is damaged at ${issue.path.join(".") || "its root"}: ${issue.message}`
        : "The project file is damaged.",
    };
  }
  return { ok: true, file: parsed.data };
}

/** A file offered for relinking, described by what can be known cheaply. */
export interface RelinkCandidate {
  name: string;
  fileSizeBytes: string;
  checksum?: string;
}

export interface RelinkMatch {
  assetId: string;
  candidateIndex: number;
  /** How sure the match is. A checksum is proof; a name and size is a guess. */
  confidence: "checksum" | "name-and-size";
}

export interface RelinkPlan {
  matches: RelinkMatch[];
  unmatched: MediaHint[];
}

/**
 * Match saved media hints against files the user offered.
 *
 * Checksums win, and win first: the same bytes are the same media whatever the
 * file has been renamed to. Name and size is the fallback, and is reported as a
 * guess rather than silently treated as proof — a renamed file with identical
 * bytes should relink, a different file that happens to share a name and size
 * should be something the user can see is uncertain.
 *
 * A candidate matches at most one asset, so two assets that share a checksum do
 * not both claim the same file.
 */
export function planRelink(
  hints: readonly MediaHint[],
  candidates: readonly RelinkCandidate[],
): RelinkPlan {
  const taken = new Set<number>();
  const matches: RelinkMatch[] = [];
  const unmatched: MediaHint[] = [];

  const claim = (
    hint: MediaHint,
    predicate: (candidate: RelinkCandidate) => boolean,
    confidence: RelinkMatch["confidence"],
  ): boolean => {
    const index = candidates.findIndex(
      (candidate, at) => !taken.has(at) && predicate(candidate),
    );
    if (index === -1) return false;
    taken.add(index);
    matches.push({ assetId: hint.assetId, candidateIndex: index, confidence });
    return true;
  };

  // Two passes, not one: a checksum match for a later hint must not lose its
  // file to an earlier hint's name-and-size guess.
  const pending = hints.filter(
    (hint) =>
      !claim(hint, (candidate) => candidate.checksum === hint.checksum, "checksum"),
  );
  for (const hint of pending) {
    const matched = claim(
      hint,
      (candidate) =>
        candidate.name === hint.name &&
        candidate.fileSizeBytes === hint.fileSizeBytes,
      "name-and-size",
    );
    if (!matched) unmatched.push(hint);
  }
  return { matches, unmatched };
}
