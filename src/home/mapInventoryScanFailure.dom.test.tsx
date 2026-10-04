// @vitest-environment happy-dom
/**
 * Issue #3423: a scan whose unitsync `Init` failed has no data and carries the
 * engine's reason in `error`. The map inventory must not read that as a player
 * with no maps, because the home page then promotes a download.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: null as unknown,
  error: null as string | null,
}));

vi.mock("../content/config", () => ({
  useUnitsyncScan: () => ({
    data: state.data,
    loading: false,
    error: state.error,
    cancelled: false,
  }),
}));
vi.mock("../content/branding", () => ({
  useCachedImage: () => undefined,
  useCatalogLoaded: () => true,
  useSuggestedMapLists: () => [],
  useSuggestedMaps: () => [],
}));
vi.mock("../downloads/bindings", () => ({
  dlInstalledContent: async () => ({ maps: [], games: [] }),
}));
vi.mock("../downloads/config", () => ({
  useContentRoots: () => ({ paths: ["/d"], loading: false }),
  useWriteRoot: () => "/d",
}));
vi.mock("../downloads/DownloadQueueProvider", () => ({
  identityOf: () => "",
  useDownloadComplete: () => {},
  useDownloadQueue: () => ({}),
}));
vi.mock("../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/e", dataDir: "/d" },
    loading: false,
  }),
}));

const { useMapInventory, noMapsInstalled } = await import("./suggestedMap");

describe("the map inventory when the scan did not answer", () => {
  it("is not an empty install", async () => {
    state.data = null;
    state.error = "no space left on device";
    const { result } = renderHook(() => useMapInventory());
    await vi.waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.scanFailed).toBe(true);
    expect(noMapsInstalled(result.current)).toBe(false);
  });

  it("still reports an empty install when the scan answered", async () => {
    state.data = { maps: [], games: [] };
    state.error = null;
    const { result } = renderHook(() => useMapInventory());
    await vi.waitFor(() => expect(result.current.known).toBe(true));
    expect(noMapsInstalled(result.current)).toBe(true);
  });
});
