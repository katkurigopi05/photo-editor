import { describe, expect, it } from "vitest";
import {
  exportSrt,
  formatSrtTimestamp,
  parseSrt,
  parseSrtTimestamp,
  renderActiveCaption,
  type SubtitleCue,
} from "../src/auto-captions.js";

describe("Auto-Captions & Subtitle Timing Engine", () => {
  it("formats and parses SRT timestamps bidirectionally", () => {
    const micros = 3723450000n; // 1h 2m 3.45s -> 01:02:03,450
    const str = formatSrtTimestamp(micros);
    expect(str).toBe("01:02:03,450");

    const parsed = parseSrtTimestamp(str);
    expect(parsed).toBe(micros);
  });

  it("parses multi-line SRT documents cleanly", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
Welcome to Project Director!

2
00:00:04,000 --> 00:00:06,200
Editing video has never been faster.`;

    const cues = parseSrt(srt);
    expect(cues.length).toBe(2);
    expect(cues[0]?.text).toBe("Welcome to Project Director!");
    expect(cues[0]?.startMicroseconds).toBe(1_000_000n);
    expect(cues[0]?.endMicroseconds).toBe(3_500_000n);

    expect(cues[1]?.text).toBe("Editing video has never been faster.");
    expect(cues[1]?.startMicroseconds).toBe(4_000_000n);
  });

  it("exports subtitle cues back to valid SRT format", () => {
    const cues: SubtitleCue[] = [
      {
        id: "1",
        startMicroseconds: 500_000n,
        endMicroseconds: 1_500_000n,
        text: "Hello world.",
      },
    ];

    const exported = exportSrt(cues);
    expect(exported).toContain("00:00:00,500 --> 00:00:01,500");
    expect(exported).toContain("Hello world.");
  });

  it("renders active word karaoke and typewriter animation markup", () => {
    const cue: SubtitleCue = {
      id: "cue-1",
      startMicroseconds: 0n,
      endMicroseconds: 3_000_000n,
      text: "Speed up editing",
      words: [
        { word: "Speed", startMicroseconds: 0n, endMicroseconds: 800_000n },
        { word: "up", startMicroseconds: 800_000n, endMicroseconds: 1_400_000n },
        { word: "editing", startMicroseconds: 1_400_000n, endMicroseconds: 2_500_000n },
      ],
    };

    // At 1.0s, "up" is active
    const karaoke = renderActiveCaption(cue, 1_000_000n, "karaoke");
    expect(karaoke.activeWordIndex).toBe(1);
    expect(karaoke.renderedText).toContain('<span class="active">up</span>');

    const typewriter = renderActiveCaption(cue, 1_000_000n, "typewriter");
    expect(typewriter.renderedText).toBe("Speed up");
  });
});
