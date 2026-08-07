import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ProjectSession } from "../session.js";
import { asJson, capped } from "./format.js";

/**
 * Read-only tools.
 *
 * These summarise rather than dump: a project's full JSON can run to hundreds
 * of kilobytes of clips and effect parameters, and an agent that has to read
 * all of it to answer "how long is this edit?" is being made to pay for the
 * privilege. get_project_json is there for when the whole thing really is
 * wanted.
 */

const DEFAULT_LIMIT = 50;

export function registerInspectTools(
  server: McpServer,
  session: ProjectSession,
): void {
  server.registerTool(
    "open_project",
    {
      title: "Open (or start) a project file",
      description:
        "Open a Director project file and make it the target of every other " +
        "tool. The file stores the operation log, so opening restores full " +
        "edit history. A path that does not exist yet is not an error — it " +
        "becomes a new project once create_project is called.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            "Path to a .director.json file, absolute or relative to the " +
              "server's --root. Paths outside the root are refused.",
          ),
      },
    },
    async ({ path }) => {
      const opened = await session.open(path);
      return asJson({
        // The resolved path, not the requested one: relative input and the
        // root confinement both mean they can differ, and the agent should
        // see where its edits are actually going.
        path: opened.path,
        root: session.getRoot(),
        existed: opened.existed,
        operations: opened.operations,
        hasProject: session.getProject() !== null,
        version: session.getVersion(),
        note: opened.existed
          ? undefined
          : "File does not exist yet; call create_project to start it.",
      });
    },
  );

  server.registerTool(
    "project_summary",
    {
      title: "Summarise the open project",
      description:
        "Counts and totals for the open project: version, assets, sequences, " +
        "tracks, clips, and whether undo/redo are available.",
      inputSchema: {},
    },
    () => {
      const project = session.requireProject();
      const sequences = project.sequences.map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
        tracks: sequence.tracks.length,
        clips: sequence.tracks.reduce(
          (total, track) => total + track.clips.length,
          0,
        ),
      }));
      return asJson({
        path: session.getPath(),
        name: project.name,
        version: project.currentVersion,
        settings: project.settings,
        assets: project.assets.length,
        sequences,
        operations: session.getOperations().length,
        canUndo: session.canUndo(),
        canRedo: session.canRedo(),
      });
    },
  );

  server.registerTool(
    "list_assets",
    {
      title: "List registered assets",
      description:
        "Every media asset registered in the project, with kind, URI and " +
        "duration. Clips reference these by id.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    ({ limit }) => {
      const project = session.requireProject();
      const page = capped(project.assets, limit ?? DEFAULT_LIMIT);
      return asJson({
        ...page,
        items: page.items.map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          uri: asset.originalUri,
          durationUs: asset.metadata.durationUs,
          width: asset.metadata.width,
          height: asset.metadata.height,
        })),
      });
    },
  );

  server.registerTool(
    "list_clips",
    {
      title: "List clips on the timeline",
      description:
        "Clips in a sequence with their track, timing and effect count. Times " +
        "are microseconds as decimal strings, which is how the engine stores " +
        "them — do not convert to floats and back.",
      inputSchema: {
        sequenceId: z
          .string()
          .optional()
          .describe("Defaults to the project's first sequence"),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    ({ sequenceId, limit }) => {
      const project = session.requireProject();
      const sequence =
        sequenceId === undefined
          ? project.sequences[0]
          : project.sequences.find((candidate) => candidate.id === sequenceId);
      if (sequence === undefined) {
        return asJson(
          {
            error: sequenceId
              ? `No sequence with id ${sequenceId}.`
              : "The project has no sequences.",
          },
          true,
        );
      }
      const clips = sequence.tracks.flatMap((track) =>
        track.clips.map((clip) => ({
          id: clip.id,
          trackId: track.id,
          trackKind: track.kind,
          assetId: clip.assetId,
          timelineStartUs: clip.timelineStartUs,
          timelineDurationUs: clip.timelineDurationUs,
          sourceInUs: clip.sourceInUs,
          sourceOutUs: clip.sourceOutUs,
          effects: clip.effects.length,
        })),
      );
      return asJson({
        sequenceId: sequence.id,
        ...capped(clips, limit ?? DEFAULT_LIMIT),
      });
    },
  );

  server.registerTool(
    "get_clip",
    {
      title: "Get one clip in full",
      description:
        "A single clip including its complete effect stack and parameters.",
      inputSchema: { clipId: z.string().min(1) },
    },
    ({ clipId }) => {
      const project = session.requireProject();
      for (const sequence of project.sequences) {
        for (const track of sequence.tracks) {
          const clip = track.clips.find((candidate) => candidate.id === clipId);
          if (clip !== undefined) {
            return asJson({ sequenceId: sequence.id, trackId: track.id, clip });
          }
        }
      }
      return asJson({ error: `No clip with id ${clipId}.` }, true);
    },
  );

  server.registerTool(
    "get_history",
    {
      title: "Read the operation log",
      description:
        "The project's edit history, most recent last: what changed, who did " +
        "it (user vs agent) and at which version. This is the file's source " +
        "of truth — the project is derived from it by replay.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    ({ limit }) => {
      const operations = session.getOperations();
      const window = limit ?? 20;
      const recent = operations.slice(-window);
      return asJson({
        total: operations.length,
        showing: recent.length,
        operations: recent.map((operation) => ({
          commandType: operation.command.commandType,
          actor: operation.command.actor,
          createdAt: operation.command.createdAt,
          baseVersion: operation.baseVersion,
          resultingVersion: operation.resultingVersion,
        })),
      });
    },
  );

  server.registerTool(
    "get_project_json",
    {
      title: "Get the whole project as JSON",
      description:
        "The complete project state. Large — prefer project_summary, " +
        "list_clips or get_clip unless you genuinely need everything.",
      inputSchema: {},
    },
    () => asJson(session.requireProject()),
  );
}
