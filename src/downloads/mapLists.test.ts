import { describe, expect, it } from "vitest";
import type { SuggestedMap, SuggestedMapList } from "../content/branding";
import type { EnqueueInput } from "./DownloadQueueProvider";
import {
  mergeMapLists,
  packMapState,
  packSummary,
  suggestedMapToInput,
} from "./mapLists";

const mapEntry = (p: Partial<SuggestedMap> = {}): SuggestedMap => ({
  id: "m",
  title: "A Map",
  download: { kind: "map", springName: "A Map v1" },
  ...p,
});

const list = (id: string, maps: SuggestedMap[] = []): SuggestedMapList => ({
  id,
  title: id,
  maps,
});

describe("suggestedMapToInput", () => {
  it("maps a springname download to a queue 'map' input", () => {
    const input = suggestedMapToInput(mapEntry(), "/root");
    expect(input).toEqual({
      kind: "map",
      label: "A Map",
      args: {
        springName: "A Map v1",
        searchUrl: undefined,
        writePath: "/root",
      },
    });
  });

  it("maps a direct-url download to a queue 'file' input under maps/", () => {
    const input = suggestedMapToInput(
      mapEntry({
        download: { kind: "url", url: "https://x/y.sd7", filename: "y.sd7" },
      }),
      "/root",
    );
    expect(input).toEqual({
      kind: "file",
      label: "A Map",
      args: {
        url: "https://x/y.sd7",
        destDir: "/root/maps",
        filename: "y.sd7",
      },
    });
  });

  it("returns null for a direct-url download when no write path is set", () => {
    const input = suggestedMapToInput(
      mapEntry({
        download: { kind: "url", url: "https://x/y.sd7", filename: "y.sd7" },
      }),
      undefined,
    );
    expect(input).toBeNull();
  });

  it("returns null for a rapid download (not a map kind)", () => {
    const input = suggestedMapToInput(
      mapEntry({ download: { kind: "rapid", tag: "game:stable" } }),
      "/root",
    );
    expect(input).toBeNull();
  });
});

const input = (): EnqueueInput => ({
  kind: "map",
  label: "A Map",
  args: { springName: "A Map v1", searchUrl: undefined, writePath: "/root" },
});

describe("packMapState", () => {
  it("is unavailable when no queue input can be built", () => {
    expect(
      packMapState({
        input: null,
        filename: "a.sd7",
        installed: new Set(["a.sd7"]),
        queueStatus: null,
      }),
    ).toBe("unavailable");
  });

  it("is installed when the filename is present on disk", () => {
    expect(
      packMapState({
        input: input(),
        filename: "A_Map.sd7",
        installed: new Set(["a_map.sd7"]),
        queueStatus: null,
      }),
    ).toBe("installed");
  });

  it("is installed when the queue reports done even without a filename match", () => {
    expect(
      packMapState({
        input: input(),
        filename: undefined,
        installed: new Set(),
        queueStatus: "done",
      }),
    ).toBe("installed");
  });

  it("reflects an active download", () => {
    expect(
      packMapState({
        input: input(),
        installed: new Set(),
        queueStatus: "active",
      }),
    ).toBe("active");
  });

  it("reflects a queued download", () => {
    expect(
      packMapState({
        input: input(),
        installed: new Set(),
        queueStatus: "queued",
      }),
    ).toBe("queued");
  });

  it("is available when idle, and after a failed/canceled attempt (retryable)", () => {
    expect(
      packMapState({ input: input(), installed: new Set(), queueStatus: null }),
    ).toBe("available");
    expect(
      packMapState({
        input: input(),
        installed: new Set(),
        queueStatus: "error",
      }),
    ).toBe("available");
    expect(
      packMapState({
        input: input(),
        installed: new Set(),
        queueStatus: "canceled",
      }),
    ).toBe("available");
  });
});

describe("packSummary", () => {
  it("counts each bucket and flags completion", () => {
    expect(
      packSummary(["installed", "installed", "active", "queued", "available"]),
    ).toEqual({
      total: 5,
      done: 2,
      inFlight: 2,
      pending: 1,
      complete: false,
    });
  });

  it("is complete only when every map is installed", () => {
    expect(packSummary(["installed", "installed"]).complete).toBe(true);
  });

  it("an empty pack is not complete", () => {
    expect(packSummary([])).toEqual({
      total: 0,
      done: 0,
      inFlight: 0,
      pending: 0,
      complete: false,
    });
  });
});

describe("mergeMapLists", () => {
  it("keeps catalog first, then profile", () => {
    const merged = mergeMapLists([list("a")], [list("b")]);
    expect(merged.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("dedupes by id, first (catalog) wins", () => {
    const catalog = [list("dup", [mapEntry({ id: "cat" })])];
    const profile = [list("dup", [mapEntry({ id: "prof" })]), list("extra")];
    const merged = mergeMapLists(catalog, profile);
    expect(merged.map((l) => l.id)).toEqual(["dup", "extra"]);
    expect(merged[0].maps[0].id).toBe("cat");
  });
});
