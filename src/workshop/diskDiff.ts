/**
 * Turning a line diff into what the disk diff drawer shows (issue #2636).
 *
 * `diff.rs` computes the raw line-by-line diff, backup against current file.
 * Showing every unchanged line of a 300-line file for a one-line edit would
 * bury the change, so a run of equal lines longer than a few lines collapses
 * to a count, keeping context on the side that borders a change. A run at the
 * very start or end of the file only keeps the side that borders a change,
 * since there is no change on its other side to read up to.
 */
import type { DiffLine } from "./inPlace";

/** How many unchanged lines either side of a change stay on screen. */
const CONTEXT = 3;

export type DisplayItem =
  | { type: "line"; id: string; line: DiffLine }
  | { type: "gap"; id: string; count: number };

function lineId(line: DiffLine): string {
  return `${line.oldLine ?? "-"}:${line.newLine ?? "-"}`;
}

/** `lines` grouped for display, with long runs of unchanged lines collapsed
 *  to a single gap marker. */
export function collapseContext(
  lines: DiffLine[],
  context = CONTEXT,
): DisplayItem[] {
  const out: DisplayItem[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "equal") {
      out.push({ type: "line", id: lineId(lines[i]), line: lines[i] });
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === "equal") j++;
    const run = lines.slice(i, j);
    const before = i === 0 ? 0 : context;
    const after = j === lines.length ? 0 : context;
    if (run.length <= before + after) {
      for (const line of run)
        out.push({ type: "line", id: lineId(line), line });
    } else {
      for (const line of run.slice(0, before))
        out.push({ type: "line", id: lineId(line), line });
      out.push({
        type: "gap",
        id: `gap-${lineId(run[before])}`,
        count: run.length - before - after,
      });
      for (const line of run.slice(run.length - after))
        out.push({ type: "line", id: lineId(line), line });
    }
    i = j;
  }
  return out;
}
