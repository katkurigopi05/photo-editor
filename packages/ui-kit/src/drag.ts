import type { TimelineClip } from "@director/project-schema";
import type {
  MoveClipCommand,
  TrimClipCommand,
} from "@director/command-schema";
import { pixelsToUsDelta } from "./units.js";

/**
 * Resolve a timeline drag gesture into a validated command payload. Pure
 * geometry: pixel deltas become canonical microsecond strings and are clamped
 * to legal ranges before a command is ever built. The caller wraps the result
 * with a `CommandContext` via the matching builder.
 */

export type ClipDragKind = "move" | "trim-left" | "trim-right";

export interface ClipDragInput {
  kind: ClipDragKind;
  sequenceId: string;
  clip: TimelineClip;
  /** Target track for a move (ignored for trims). */
  targetTrackId?: string;
  deltaPixels: number;
  pixelsPerSecond: number;
}

export type ClipDragResult =
  | { commandType: "timeline.move_clip"; payload: MoveClipCommand["payload"] }
  | { commandType: "timeline.trim_clip"; payload: TrimClipCommand["payload"] };

function clampNonNegative(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

export function resolveClipDrag(input: ClipDragInput): ClipDragResult {
  const { clip, sequenceId } = input;
  const deltaUs = pixelsToUsDelta(input.deltaPixels, input.pixelsPerSecond);

  if (input.kind === "move") {
    const start = clampNonNegative(BigInt(clip.timelineStartUs) + deltaUs);
    return {
      commandType: "timeline.move_clip",
      payload: {
        sequenceId,
        clipId: clip.id,
        targetTrackId: input.targetTrackId ?? clip.trackId,
        timelineStartUs: start.toString(),
      },
    };
  }

  const sourceIn = BigInt(clip.sourceInUs);
  const sourceOut = BigInt(clip.sourceOutUs);

  if (input.kind === "trim-left") {
    // Dragging the left edge changes the in-point; keep it below the out-point.
    let newIn = clampNonNegative(sourceIn + deltaUs);
    if (newIn >= sourceOut) newIn = sourceOut - 1n;
    return {
      commandType: "timeline.trim_clip",
      payload: {
        sequenceId,
        clipId: clip.id,
        sourceInUs: newIn.toString(),
        sourceOutUs: clip.sourceOutUs,
      },
    };
  }

  // trim-right: dragging the right edge changes the out-point.
  let newOut = sourceOut + deltaUs;
  if (newOut <= sourceIn) newOut = sourceIn + 1n;
  return {
    commandType: "timeline.trim_clip",
    payload: {
      sequenceId,
      clipId: clip.id,
      sourceInUs: clip.sourceInUs,
      sourceOutUs: newOut.toString(),
    },
  };
}
