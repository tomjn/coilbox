import { useEffect, useState } from "react";
import { plantForestOffThread } from "../../landJobs";
import type { ForestPlantInput, PlantedForest } from "./plant";

/**
 * A shallow copy whose typed arrays are ordinary properties again. Land from
 * the worker comes back with its arrays hidden from key enumeration (see
 * `landJobs.ts`), and a worker message leaves hidden properties behind.
 */
export function sendable<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (ArrayBuffer.isView(child)) out[key] = child;
  }
  return out as T;
}

/**
 * The forest planted from `input` in the land worker. `pending` is true until
 * it is in. A failed planting leaves the map without trees rather than
 * without a map.
 */
export function usePlantedForest(input: ForestPlantInput | undefined): {
  pending: boolean;
  planted?: PlantedForest;
} {
  const [done, setDone] = useState<{
    input: ForestPlantInput;
    planted?: PlantedForest;
  } | null>(null);

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    plantForestOffThread(input).then(
      (planted) => {
        if (!cancelled) setDone({ input, planted });
      },
      (err) => {
        if (cancelled) return;
        console.warn("The forest could not be planted.", err);
        setDone({ input });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [input]);

  if (!input) return { pending: false };
  if (done?.input !== input) return { pending: true };
  return { pending: false, planted: done.planted };
}
