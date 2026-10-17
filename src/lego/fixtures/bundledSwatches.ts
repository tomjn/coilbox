/**
 * The bundled pack's swatches and round panels, read from its `pack.json`, for
 * tests that draw shapes. Node only: the app gets them from the pack loader.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readRoundPanels, readSwatches } from "../pack";
import type { ShapeRoundPanel, ShapeSwatch } from "../shapes";

function bundledManifest(): { swatches?: unknown; roundPanels?: unknown } {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../src-tauri/legoparts/pack.json", import.meta.url),
      ),
      "utf8",
    ),
  );
}

export function bundledSwatches(): ShapeSwatch[] {
  return readSwatches(bundledManifest().swatches).usable;
}

export function bundledRoundPanels(): ShapeRoundPanel[] {
  return readRoundPanels(bundledManifest().roundPanels).usable;
}
