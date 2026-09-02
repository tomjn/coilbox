/**
 * What a 3D view costs to draw, measured from the running app (issue #2292).
 *
 * three counts most of it already: `renderer.info` carries the draw calls and
 * triangles of the last frame, and the geometries, textures and programs the
 * renderer is holding. What was missing is a way to reach them, because every
 * renderer lives inside the closure that built it. `useCanvas3D` registers each
 * one here as it is built and drops it on teardown, so whatever is on screen can
 * be asked what it costs.
 *
 * Timings here are main thread only, and that is a limit of the platform rather
 * than a choice. The app runs in a WKWebView, which offers neither
 * `EXT_disjoint_timer_query_webgl2` nor `performance.memory`, so there is no GPU
 * clock to read and no heap size to ask for. It also rounds `performance.now`
 * to the millisecond, which is why `timeRenders` works in blocks. What it
 * measures is how long `renderer.render` takes to walk the scene and issue its
 * draw calls, which is the cost that holds up the interface. GPU work only
 * shows up in it when the command queue backs up far enough to stall the
 * driver.
 *
 * From the app's console, or anything else that can run JS in the webview:
 *
 *     coilboxRenderStats.counts()
 *     coilboxRenderStats.timeRenders(120)
 *     await coilboxRenderStats.watchFrames(2000)
 *
 * Resident memory is an operating system number rather than a webview one. On
 * macOS the figure is `ps -o rss= -p <pid>` summed over the app process and its
 * WebKit content and GPU processes.
 */

import type * as THREE from "three";

/** What the last frame cost, and what the renderer is holding to draw it. */
export interface RenderCounts {
  /** Draw calls in the frame just drawn. */
  calls: number;
  triangles: number;
  lines: number;
  points: number;
  /** Live on the GPU. Shared across every view using this renderer. */
  geometries: number;
  textures: number;
  programs: number;
}

/** How long a run of frames took, in milliseconds. */
export interface FrameTiming {
  samples: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

/** Frames a view drew on its own, without being asked. */
export interface FrameWatch {
  elapsedMs: number;
  frames: number;
  framesPerSecond: number;
}

interface Registered {
  renderer: THREE.WebGLRenderer;
  /** Draw one frame of this view. */
  render: () => void;
}

const canvases = new Set<Registered>();

/** Take a canvas onto the list the console can ask about, and off it again. */
export function registerCanvas3D(entry: Registered): () => void {
  canvases.add(entry);
  return () => {
    canvases.delete(entry);
  };
}

/**
 * The view the numbers are about: the largest canvas registered.
 *
 * A page can hold several at once, such as a map beside a row of thumbnails.
 * The one filling the window is the one worth measuring, and it is the biggest
 * every time.
 */
function subject(): Registered | null {
  let best: Registered | null = null;
  let area = 0;
  for (const one of canvases) {
    const { width, height } = one.renderer.domElement;
    if (width * height >= area) {
      area = width * height;
      best = one;
    }
  }
  return best;
}

/** The value at `fraction` through a sorted list, by nearest rank. */
function rank(sorted: number[], fraction: number): number {
  const index = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

/** Reduce a run of frame times to the shape of its distribution. */
export function summarise(times: number[]): FrameTiming {
  if (times.length === 0) {
    return {
      samples: 0,
      meanMs: 0,
      medianMs: 0,
      p95Ms: 0,
      minMs: 0,
      maxMs: 0,
    };
  }
  const sorted = [...times].sort((a, b) => a - b);
  let total = 0;
  for (const one of sorted) total += one;
  return {
    samples: sorted.length,
    meanMs: total / sorted.length,
    medianMs: rank(sorted, 0.5),
    p95Ms: rank(sorted, 0.95),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

/**
 * Draw one frame and say what it cost.
 *
 * The frame is drawn rather than the last one read back, because three resets
 * the per-frame counters at the start of every render and an on-demand view may
 * not have drawn for minutes.
 */
export function counts(): RenderCounts | null {
  const one = subject();
  if (!one) return null;
  one.render();
  const { render, memory, programs } = one.renderer.info;
  return {
    calls: render.calls,
    triangles: render.triangles,
    lines: render.lines,
    points: render.points,
    geometries: memory.geometries,
    textures: memory.textures,
    programs: programs?.length ?? 0,
  };
}

/**
 * Time frames drawn back to back, in blocks, and report the cost of one.
 *
 * Back to back rather than one per display refresh, because a view that draws
 * in 4 ms and one that takes 12 ms both report a 16.7 ms interval when the
 * frames are paced by the screen.
 *
 * In blocks because this webview rounds `performance.now` to the millisecond,
 * which is most of a frame: timing one frame at a time gives a string of zeroes
 * with the occasional 3 in it. A block of `size` frames is long enough for the
 * clock to resolve, and dividing by `size` puts the answer back in frames.
 */
export function timeRenders(
  blocks = 20,
  size = 20,
  warmup = 10,
): FrameTiming | null {
  const one = subject();
  if (!one) return null;
  for (let i = 0; i < warmup; i++) one.render();
  const times: number[] = [];
  for (let block = 0; block < blocks; block++) {
    const at = performance.now();
    for (let i = 0; i < size; i++) one.render();
    times.push((performance.now() - at) / size);
  }
  return summarise(times);
}

/**
 * Count the frames a view draws by itself over a stretch of time.
 *
 * Nothing is asked of the view, so a scene that is genuinely on demand answers
 * zero and one with a loop in it answers with the loop's rate.
 */
export async function watchFrames(ms = 2000): Promise<FrameWatch | null> {
  const one = subject();
  if (!one) return null;
  const from = one.renderer.info.render.frame;
  const at = performance.now();
  await new Promise((done) => setTimeout(done, ms));
  const elapsedMs = performance.now() - at;
  const frames = one.renderer.info.render.frame - from;
  return { elapsedMs, frames, framesPerSecond: (frames * 1000) / elapsedMs };
}

/** Reachable from the app's console in every build, because a release build is
 *  what anyone actually runs and measuring the development one instead would
 *  answer a different question. */
if (typeof window !== "undefined") {
  (
    window as typeof window & { coilboxRenderStats?: unknown }
  ).coilboxRenderStats = {
    counts,
    timeRenders,
    watchFrames,
    canvases: () => canvases.size,
  };
}
