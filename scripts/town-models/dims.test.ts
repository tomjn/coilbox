import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { BUILDINGS } from "../../src/conquest/galaxy3d/towns3d/buildings";
import { OUTPOSTS } from "../../src/conquest/galaxy3d/towns3d/outposts";

test("dims", () => {
  const f = (m: {
    id: string;
    lots: readonly number[];
    height: number;
    landmark?: boolean;
    filler?: boolean;
  }) =>
    `${m.id} ${m.lots.join("x")} h=${m.height}${m.landmark ? " L" : ""}${m.filler ? " F" : ""}`;
  writeFileSync(
    new URL("../../docs/reports/town-models/dims.txt", import.meta.url),
    [...BUILDINGS.map(f), "--", ...OUTPOSTS.map(f)].join("\n"),
  );
});
