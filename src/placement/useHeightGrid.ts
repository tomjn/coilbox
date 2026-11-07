import { useEffect, useState } from "react";
import { type HeightGrid, readHeightGrid } from "./terrain";

/**
 * The worker's raw height grid, fetched once for everything that wants it.
 *
 * One read because there is one grid and two readers: the terrain the preview
 * displaces and the ground a building's verdict is worked out on (issue #1730).
 * Tens of megabytes on a large map, so a second fetch is not a rounding error.
 *
 * The grid is only handed back for the `src` it was read from, so a page that
 * moves to another map never pairs the last map's words with the next one's
 * size and height range. `error` says why a read came back with nothing.
 */
export function useHeightGrid(
  src?: string,
  width?: number,
  height?: number,
): { grid: HeightGrid | null; read: boolean; error: string | null } {
  const [state, setState] = useState<{
    src: string;
    grid: HeightGrid | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!src || !width || !height) return;
    let cancelled = false;
    readHeightGrid(src, width, height)
      .then((grid) => {
        if (cancelled) return;
        setState({
          src,
          grid,
          error: grid ? null : "the heights file is not this map's size",
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
  if (!src || !width || !height) return { grid: null, read: true, error: null };
  if (state?.src !== src) return { grid: null, read: false, error: null };
  return { grid: state.grid, read: true, error: state.error };
}
