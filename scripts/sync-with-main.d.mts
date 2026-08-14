export interface AddedBlock {
  lines: string[];
  follows: string | null;
}

export function paragraphTexts(xml: string): string[];

export function addedBlocks(before: string[], after: string[]): AddedBlock[];

export function removeBlock(
  lines: string[],
  block: AddedBlock,
  describe: string,
): string[];
