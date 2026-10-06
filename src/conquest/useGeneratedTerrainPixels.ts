import { useEffect, useState } from "react";
import type { TerrainPixels } from "./galaxy3d/terrainLoad";
import { terrainPixelsOffThread } from "./landJobs";
import type { GalaxyDoc } from "./model";
import { generatedLandKey } from "./territories";

/**
 * The land of a generated Cities or Territories document, for the strategic
 * view. A generated map stores no pixels, so they are built again from the
 * document, off the main thread. `pending` is true until they are in, and the
 * view must not be drawn before then: it places every marker at ground height
 * as it builds. A document with no generated land is never pending.
 */
export function useGeneratedTerrainPixels(doc: GalaxyDoc | undefined): {
  pending: boolean;
  pixels?: TerrainPixels;
  /** Why the land could not be built. */
  error?: string;
} {
  const key = doc ? generatedLandKey(doc) : null;
  const [built, setBuilt] = useState<{
    key: string;
    pixels?: TerrainPixels;
    error?: string;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is everything about the document the land is built from
  useEffect(() => {
    if (!doc || key === null) return;
    let cancelled = false;
    terrainPixelsOffThread(doc).then(
      (pixels) => {
        if (!cancelled) setBuilt({ key, pixels });
      },
      (err) => {
        if (cancelled) return;
        setBuilt({
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (key === null) return { pending: false };
  if (built?.key !== key) return { pending: true };
  return { pending: false, pixels: built.pixels, error: built.error };
}
