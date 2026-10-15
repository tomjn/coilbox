import type { EngineRelease } from "./bindings";
import { loadRecoilEngines } from "./engineLists";

/** The newest Recoil release for this platform, or null when none is available
 * (e.g. macOS). `releases` is newest-first from the backend. */
export async function fetchNewestRecoil(): Promise<{
  release: EngineRelease | null;
  platform: string;
}> {
  const { releases, platform } = await loadRecoilEngines();
  return { release: releases[0] ?? null, platform };
}
