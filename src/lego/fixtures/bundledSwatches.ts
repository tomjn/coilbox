/**
 * The bundled pack's swatches, read from its `pack.json`, for tests that draw
 * shapes. Node only: the app gets them from the pack loader.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSwatches } from "../pack";
import type { ShapeSwatch } from "../shapes";

export function bundledSwatches(): ShapeSwatch[] {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../src-tauri/legoparts/pack.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as { swatches?: unknown };
  return readSwatches(manifest.swatches).usable;
}
