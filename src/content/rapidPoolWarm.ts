/**
 * Side-effecting rapid-pool warm helper (kept out of the pure `rapidPool.ts` so
 * that module has no binding imports). Warms every valid root's `.sdp` manifests
 * into the OS page cache; safe to fire-and-forget.
 */

import {
  type ContentState,
  contentStateLoad,
  contentWarmRapidPool,
} from "./bindings";

/**
 * Warm every valid root's rapid pool. Pass the current state to avoid a reload,
 * or omit it to fetch the persisted snapshot. Resolves quietly when there are no
 * valid roots.
 */
export async function warmAllRoots(state?: ContentState): Promise<void> {
  const s = state ?? (await contentStateLoad(undefined)).state;
  const roots = s.roots.filter((r) => r.valid).map((r) => r.path);
  if (roots.length === 0) return;
  await contentWarmRapidPool({ roots });
}
