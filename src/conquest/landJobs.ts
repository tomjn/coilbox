import type { TerrainPixels } from "./galaxy3d/terrainLoad";
import type { GenerateOptions } from "./generate";
import {
  eachTypedArray,
  type LandJob,
  type LandJobResults,
  type LandPreview,
  runLandJob,
} from "./landJob";
import type { RegenerateEnv } from "./mapStyle";
import type { GalaxyDoc } from "./model";
import { generatedLandKey } from "./territories";

/**
 * Map generation off the main thread. Each call posts a job to one worker and
 * resolves with its result, so the page keeps drawing while land is built.
 * Where there is no `Worker`, which is the test runner, the job runs here.
 */

interface Waiting {
  resolve: (result: never) => void;
  reject: (err: Error) => void;
}

let worker: Worker | undefined;
let lastId = 0;
const waiting = new Map<number, Waiting>();

function landWorker(): Worker {
  if (worker) return worker;
  const made = new Worker(new URL("./landJob.worker.ts", import.meta.url), {
    type: "module",
  });
  made.onmessage = (
    event: MessageEvent<{ id: number; result?: unknown; error?: string }>,
  ) => {
    const { id, result, error } = event.data;
    const job = waiting.get(id);
    if (!job) return;
    waiting.delete(id);
    if (error !== undefined) job.reject(new Error(error));
    else job.resolve(result as never);
  };
  // The worker itself failed, so nothing it was asked for will come back.
  made.onerror = (event) => {
    const err = new Error(event.message || "the map worker stopped");
    for (const job of waiting.values()) job.reject(err);
    waiting.clear();
    made.terminate();
    worker = undefined;
  };
  worker = made;
  return made;
}

/**
 * Take the typed arrays in a job's result out of key enumeration. A result
 * goes to a component as a prop, and React's development build walks changed
 * props key by key for its performance timeline. A typed array is walked one
 * element at a time, which for a map's pixels is seconds on the main thread.
 * Every reader reaches the arrays by name, which this leaves alone.
 */
function hideTypedArrays<T>(result: T): T {
  eachTypedArray(result, (holder, key, array) => {
    Object.defineProperty(holder, key, { value: array, enumerable: false });
  });
  return result;
}

function run<K extends LandJob["kind"]>(
  job: Extract<LandJob, { kind: K }>,
): Promise<LandJobResults[K]> {
  const done =
    typeof Worker === "undefined"
      ? Promise.resolve().then(() => runLandJob(job) as LandJobResults[K])
      : new Promise<LandJobResults[K]>((resolve, reject) => {
          const id = ++lastId;
          waiting.set(id, { resolve, reject });
          landWorker().postMessage({ id, job });
        });
  return done.then(hideTypedArrays);
}

/** {@link generateMap}, off the main thread. */
export const generateMapOffThread = (opts: GenerateOptions) =>
  run({ kind: "map", opts });

/** A map for the setup form to show, with the picture of its land. */
export const landPreviewOffThread = (
  opts: GenerateOptions,
): Promise<LandPreview> => run({ kind: "preview", opts });

/** {@link regenerateGalaxy}, off the main thread. */
export const regenerateOffThread = (
  galaxy: GalaxyDoc,
  env: RegenerateEnv,
  seed: number,
) => run({ kind: "regenerate", galaxy, env, seed });

let lastPixels:
  | { key: string; pixels: Promise<TerrainPixels | undefined> }
  | undefined;

/**
 * {@link generatedTerrainPixels}, off the main thread. Undefined for a
 * document whose land is not generated. The last answer is kept, so a page
 * that asks again for the same land, as it does when the document is loaded a
 * second time, gets the same object and does not rebuild its scene.
 */
export function terrainPixelsOffThread(
  doc: GalaxyDoc,
): Promise<TerrainPixels | undefined> {
  const key = generatedLandKey(doc);
  if (key === null) return Promise.resolve(undefined);
  if (lastPixels?.key !== key) {
    const pixels = run({ kind: "pixels", doc });
    lastPixels = { key, pixels };
    // A failure is not kept, so the next ask tries again.
    pixels.catch(() => {
      if (lastPixels?.pixels === pixels) lastPixels = undefined;
    });
  }
  return lastPixels.pixels;
}
