import { dlRecoilEngines, type EngineRelease } from "./bindings";

/** The newest Recoil release for this platform, or null when none is available
 * (e.g. macOS). `releases` is newest-first from the backend. */
export async function fetchNewestRecoil(): Promise<{
  release: EngineRelease | null;
  platform: string;
}> {
  const { releases, platform } = await dlRecoilEngines(undefined);
  return { release: releases[0] ?? null, platform };
}
