import { useEffect, useMemo, useState } from "react";
import {
  type HeightGrid,
  type HeightPixels,
  heightGridFromPixels,
  type TerrainSpec,
} from "./terrain";
import type { TerrainColorSource } from "./terrainMesh";

/**
 * Getting a terrain's heights ready for the strategic view. The view builds
 * its whole scene in one go and places every marker at ground height, so the
 * heights have to be in hand before the build starts. A heightmap given as a
 * URL is read here first. Heights given as pixels need no loading.
 */

/**
 * Terrain handed to the view as pixels instead of the URLs in the document.
 * Either part may be left out and falls back to the document's URL. Keep the
 * object and its parts stable between renders (memoise them), because a new
 * one rebuilds the scene.
 */
export interface TerrainPixels {
  /** The map picture, in place of `terrain.image`. */
  color?: Exclude<TerrainColorSource, string>;
  /** The heights, in place of `terrain.heightmap`. */
  height?: HeightPixels;
}

/**
 * Read a greyscale heightmap image into a {@link HeightGrid}. The image goes
 * through a canvas, which keeps 8 bits per channel, so a 16 bit image is read
 * at 256 levels. Rejects when the image cannot be loaded or read.
 */
export function loadHeightGrid(url: string): Promise<HeightGrid> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Without this a picture from another origin cannot be read back.
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2D canvas to read the heightmap with");
        ctx.drawImage(img, 0, 0);
        resolve(
          heightGridFromPixels(
            ctx.getImageData(0, 0, canvas.width, canvas.height),
          ),
        );
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("the heightmap image did not load"));
    img.src = url;
  });
}

/**
 * The heights for a terrain, from `pixels` when given and from the document's
 * heightmap URL otherwise. `ready` is false only while a URL is loading. No
 * terrain, no heightmap, or a heightmap that cannot be read all give
 * `ready: true` with no grid, which draws a flat sheet. A failure is reported
 * once to the console.
 */
export function useTerrainHeights(
  terrain: TerrainSpec | undefined,
  pixels?: HeightPixels,
): { ready: boolean; grid?: HeightGrid } {
  const direct = useMemo(() => {
    if (!pixels) return undefined;
    try {
      return heightGridFromPixels(pixels);
    } catch (err) {
      console.warn("terrain heights are unusable, drawing a flat sheet", err);
      return undefined;
    }
  }, [pixels]);

  const url = pixels ? undefined : terrain?.heightmap;
  const [loaded, setLoaded] = useState<{
    url: string;
    grid?: HeightGrid;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    loadHeightGrid(url).then(
      (grid) => {
        if (!cancelled) setLoaded({ url, grid });
      },
      (err) => {
        if (cancelled) return;
        console.warn("terrain heightmap failed, drawing a flat sheet", err);
        setLoaded({ url });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return { ready: true, grid: direct };
  if (loaded?.url !== url) return { ready: false };
  return { ready: true, grid: loaded.grid };
}
