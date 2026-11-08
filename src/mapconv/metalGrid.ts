import { useEffect, useState } from "react";
import type { MetalGrid } from "./metalSpots";

/**
 * Fetch a map's metal map from the cache file the worker wrote, or `null` when
 * the file is not the size the map says. One byte per cell, so there is no
 * framing to do beyond checking the length.
 */
export async function readMetalGrid(
  src: string,
  width: number,
  height: number,
): Promise<MetalGrid | null> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`could not read the metal map (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length === width * height ? { bytes, width, height } : null;
}

/**
 * {@link readMetalGrid} as a hook. The grid is only handed back for the `src`
 * it was read from, so a page that moves to another map never pairs the last
 * map's bytes with the next one's size. `settled` is false until the read for
 * the current `src` has finished either way.
 */
export function useMetalGrid(
  src?: string,
  width?: number,
  height?: number,
): { grid: MetalGrid | null; error: string | null; settled: boolean } {
  const [state, setState] = useState<{
    src: string;
    grid: MetalGrid | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!src || !width || !height) return;
    let cancelled = false;
    readMetalGrid(src, width, height)
      .then((grid) => {
        if (cancelled) return;
        setState({
          src,
          grid,
          error: grid ? null : "the metal map file is not this map's size",
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ src, grid: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [src, width, height]);
  if (!src || !width || !height) {
    return { grid: null, error: null, settled: false };
  }
  if (state?.src !== src) return { grid: null, error: null, settled: false };
  return { grid: state.grid, error: state.error, settled: true };
}
