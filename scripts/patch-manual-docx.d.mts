export function markdownItemEnd(
  text: string,
  lineStart: number,
  replace: boolean,
): number;

export function docxParagraphEnd(
  xml: string,
  at: number,
  paragraphStart: number,
  replace: boolean,
): number;
