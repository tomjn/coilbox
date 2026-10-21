import { t } from "@lingui/core/macro";
import type { UnitModelResult } from "@/content/bindings";
import { unitModelTextureUrl } from "@/lib/assetUrl";

/**
 * Read back a model the batched read wrote into the model-texture cache.
 *
 * Over the asset protocol rather than through the IPC bridge, which is the point
 * of the batch writing files at all: a flattened model is megabytes of floats,
 * and the textures it names are already loaded from this same root.
 */
export async function readCachedModel(file: string): Promise<UnitModelResult> {
  const res = await fetch(unitModelTextureUrl(file));
  if (!res.ok) {
    const status = res.status;
    throw new Error(t`could not read model ${file}: ${status}`);
  }
  return (await res.json()) as UnitModelResult;
}
