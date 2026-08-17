/**
 * How a unit's build icon gets from the unitsync cache onto the screen.
 *
 * The worker writes each icon as a PNG in its cache dir and names that file on
 * the record, so a roster of several hundred crosses the bridge as short names
 * rather than megabytes of base64 (issue #1694). `icon` is the fallback, set
 * only where there was nowhere on disk to write the picture.
 */

import { unitsyncBuildpicUrl } from "../lib/assetUrl";
import { toBase64 } from "../lib/base64";
import type { UnitDisplay } from "./bindings";

/** The `src` to draw a unit's build icon with, or undefined when it has none. */
export function unitIconSrc(display?: UnitDisplay): string | undefined {
  return display?.iconFile
    ? unitsyncBuildpicUrl(display.iconFile)
    : display?.icon;
}

/**
 * The same icon as a base64 `data:` URL. Only the build-tree export wants this:
 * it writes the bytes into an HTML file or a zip, so a name pointing at this
 * machine's cache is no use to it.
 *
 * A record that already holds the icon inline is passed straight back, and one
 * whose file will not read yields nothing, which the exporter draws as a missing
 * picture rather than failing the whole export.
 */
export async function unitIconDataUrl(
  display?: UnitDisplay,
): Promise<string | undefined> {
  if (!display?.iconFile) return display?.icon;
  try {
    const res = await fetch(unitsyncBuildpicUrl(display.iconFile));
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return `data:image/png;base64,${toBase64(bytes)}`;
  } catch {
    return undefined;
  }
}
