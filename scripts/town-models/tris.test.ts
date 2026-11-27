/** Prints each open-town model's triangle count, for the detail pass's budget. */
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { TOWN_PALETTES } from "../../src/conquest/galaxy3d/landmarks/palettes";
import {
  BUILDINGS,
  buildModel,
} from "../../src/conquest/galaxy3d/towns3d/buildings";
import {
  footprint,
  OPEN_GRID,
} from "../../src/conquest/galaxy3d/towns3d/layout";

test("triangles per model", () => {
  const rows: string[] = [];
  let total = 0;
  let closeTotal = 0;
  for (const m of BUILDINGS) {
    const [w, d] = footprint(m, OPEN_GRID);
    const count = (detail: "town" | "close") =>
      buildModel(m, w, d, TOWN_PALETTES.temperate, detail).getAttribute(
        "position",
      ).count / 3;
    const tris = count("town");
    const close = count("close");
    total += tris;
    closeTotal += close;
    rows.push(
      `${m.id.padEnd(16)} ${String(tris).padStart(5)} ${String(close).padStart(5)} h=${m.height}${m.filler ? " filler" : ""}`,
    );
  }
  writeFileSync(
    new URL("../../docs/reports/town-models/tris.txt", import.meta.url)
      .pathname,
    `${rows.join("\n")}\nmodels ${BUILDINGS.length} town ${total} close ${closeTotal}\n`,
  );
});
