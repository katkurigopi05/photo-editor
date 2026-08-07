/**
 * Text layout for the `fx.text` overlay.
 *
 * Kept pure and measurement-injected so it can be tested without a canvas, and
 * so preview, GIF and MP4 wrap identically — they pass their own measurer for
 * their own output size, but the decisions are made here.
 */

/**
 * Break `text` into lines that fit `maxWidth`.
 *
 * Explicit newlines are always honoured, including blank ones, because a blank
 * line between paragraphs is deliberate. Within a line, wrapping happens on
 * word boundaries; a single word too long to fit is hard-broken rather than
 * left to overflow the frame.
 */
export function layoutTextLines(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      // A paragraph with no words is either a blank line the author typed, or
      // leading/trailing whitespace. Keep the former, drop the latter.
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      if (measure(word) <= maxWidth) {
        current = word;
        continue;
      }
      // Longer than a whole line on its own: split it at the widest prefix
      // that fits, repeatedly. Always take at least one character so a
      // pathological measurer cannot loop forever.
      let rest = word;
      while (measure(rest) > maxWidth) {
        let take = 1;
        while (take < rest.length && measure(rest.slice(0, take + 1)) <= maxWidth) {
          take++;
        }
        lines.push(rest.slice(0, take));
        rest = rest.slice(take);
      }
      current = rest;
    }
    if (current !== "") lines.push(current);
  }

  // Trim blank lines at the very start and end: those come from stray
  // whitespace, not from an intended gap.
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
