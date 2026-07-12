import { describe, expect, it } from "vitest";
import type { SuggestedMap, SuggestedMapList } from "../content/branding";
import { mergeMapLists, suggestedMapToInput } from "./mapLists";

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
