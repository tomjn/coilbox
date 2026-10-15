import { basename } from "@/lib/helpers";

function trimTrailingSeparators(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

/**
 * The map's name for a decompiled map's folder, as the Compile page's Output
 * name. A decompiled archive is unpacked into `<name>.sdd` beside it and the
 * `.smf` sits in that folder's inner `maps` folder, so the folder holding the
 * `.smf` is called "maps" and the name is taken from the `.sdd` folder, which
 * carries the archive's name without its extension.
 */
export function mapNameFromDir(dir: string): string {
  const path = trimTrailingSeparators(dir);
  if (basename(path).toLowerCase() === "maps") {
    const parent = basename(
      trimTrailingSeparators(path.slice(0, path.length - "maps".length)),
    );
    if (/\.sdd$/i.test(parent)) return parent.replace(/\.sdd$/i, "");
  }
  return basename(path).replace(/-decompiled$/, "");
}
