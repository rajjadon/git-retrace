/** A contiguous, inclusive run of line numbers. */
export interface LineRange {
  start: number;
  end: number;
}

/** Coalesces a sorted list of 0-based line numbers into contiguous ranges, e.g. [0,1,2,5] -> [{0,2},{5,5}]. Shared by every decoration provider that groups lines by bucket/color and needs one `vscode.Range` per contiguous run, not one per line. */
export function coalesceLineRanges(lines: number[]): LineRange[] {
  const ranges: LineRange[] = [];
  let start: number | undefined;
  let prev: number | undefined;
  for (const line of lines) {
    if (start === undefined) {
      start = line;
    } else if (prev !== undefined && line !== prev + 1) {
      ranges.push({ start, end: prev });
      start = line;
    }
    prev = line;
  }
  if (start !== undefined && prev !== undefined) {
    ranges.push({ start, end: prev });
  }
  return ranges;
}
