/**
 * Auto-Captions & Subtitle Timing Engine.
 *
 * Implements CapCut-style automatic caption management:
 * - SRT and WebVTT parsing and serialization
 * - Word-level microsecond timing
 * - Dynamic caption animation styles (karaoke, pop-in, typewriter, classic)
 */

export interface SubtitleWord {
  word: string;
  startMicroseconds: bigint;
  endMicroseconds: bigint;
}

export interface SubtitleCue {
  id: string;
  startMicroseconds: bigint;
  endMicroseconds: bigint;
  text: string;
  words?: readonly SubtitleWord[] | undefined;
}

export type CaptionAnimationStyle = "classic" | "karaoke" | "pop" | "typewriter";

/**
 * Format microseconds to SRT timestamp `HH:MM:SS,mmm`.
 */
export function formatSrtTimestamp(microseconds: bigint): string {
  const totalMs = Number(microseconds / 1000n);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(ms)}`;
}

/**
 * Parse SRT timestamp `HH:MM:SS,mmm` or `HH:MM:SS.mmm` to microseconds.
 */
export function parseSrtTimestamp(ts: string): bigint {
  const normalized = ts.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 3) {
    throw new Error(`Invalid timestamp format: ${ts}`);
  }

  const hours = Number(parts[0] ?? 0);
  const minutes = Number(parts[1] ?? 0);
  const secParts = (parts[2] ?? "0").split(".");
  const seconds = Number(secParts[0] ?? 0);
  const millis = Number((secParts[1] ?? "0").padEnd(3, "0").slice(0, 3));

  const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + millis;
  return BigInt(totalMs) * 1000n;
}

/**
 * Parses raw SRT string into array of SubtitleCues.
 */
export function parseSrt(srtContent: string): SubtitleCue[] {
  const blocks = srtContent.trim().split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const id = lines[0] ?? `cue-${cues.length + 1}`;
    const timeLine = lines[1] ?? "";
    const timeMatch = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );

    if (!timeMatch || !timeMatch[1] || !timeMatch[2]) continue;

    const startMicros = parseSrtTimestamp(timeMatch[1]);
    const endMicros = parseSrtTimestamp(timeMatch[2]);
    const text = lines.slice(2).join(" ");

    cues.push({
      id,
      startMicroseconds: startMicros,
      endMicroseconds: endMicros,
      text,
    });
  }

  return cues;
}

/**
 * Exports SubtitleCues to standard SRT text.
 */
export function exportSrt(cues: readonly SubtitleCue[]): string {
  return cues
    .map((cue, index) => {
      const idx = index + 1;
      const start = formatSrtTimestamp(cue.startMicroseconds);
      const end = formatSrtTimestamp(cue.endMicroseconds);
      return `${idx}\n${start} --> ${end}\n${cue.text}`;
    })
    .join("\n\n");
}

/**
 * Generates active word karaoke styling and markup for a given playback time.
 */
export function renderActiveCaption(
  cue: SubtitleCue,
  currentMicros: bigint,
  style: CaptionAnimationStyle = "karaoke",
): { renderedText: string; activeWordIndex: number } {
  const words = cue.words;

  if (!words || words.length === 0 || style === "classic") {
    return { renderedText: cue.text, activeWordIndex: -1 };
  }

  let activeIdx = -1;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w && currentMicros >= w.startMicroseconds && currentMicros <= w.endMicroseconds) {
      activeIdx = i;
      break;
    }
  }

  if (style === "typewriter") {
    // Show only words up to current time
    const visibleWords = words
      .filter((w) => currentMicros >= w.startMicroseconds)
      .map((w) => w.word);
    return {
      renderedText: visibleWords.join(" "),
      activeWordIndex: activeIdx,
    };
  }

  // Karaoke or Pop: highlight active word
  const parts = words.map((w, i) => {
    if (i === activeIdx) {
      return style === "pop" ? `**[${w.word}]**` : `<span class="active">${w.word}</span>`;
    }
    return w.word;
  });

  return {
    renderedText: parts.join(" "),
    activeWordIndex: activeIdx,
  };
}
