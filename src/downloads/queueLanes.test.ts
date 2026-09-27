import { describe, expect, it } from "vitest";
import type { EnqueueInput } from "./DownloadQueueProvider";
import {
  contentOf,
  laneOf,
  parseApacheSize,
  queuedSize,
  startable,
} from "./queueLanes";

const map = (springName: string): EnqueueInput => ({
  kind: "map",
  label: springName,
  args: { springName },
});
const file = (destDir: string, filename = "x.sd7"): EnqueueInput => ({
  kind: "file",
  label: filename,
  args: { url: `https://example.test/${filename}`, destDir, filename },
});
const rapid: EnqueueInput = {
  kind: "rapid",
  label: "BA",
  args: { tag: "ba:stable" },
};
const game: EnqueueInput = {
  kind: "game",
  label: "SF",
  args: { gameName: "SplinterFaction 0.1" },
};
const engine: EnqueueInput = {
  kind: "engineRecoil",
  label: "Engine",
  args: { version: "105", assetUrl: "https://x/e.7z", writePath: "/root" },
};

describe("contentOf", () => {
  it("names each request kind", () => {
    expect(contentOf(map("Isis"))).toBe("map");
    expect(
      contentOf({ kind: "mapAnySource", label: "", args: { mapName: "Isis" } }),
    ).toBe("map");
    expect(contentOf(rapid)).toBe("rapid");
    expect(contentOf(game)).toBe("game");
    expect(contentOf(engine)).toBe("engine");
  });

  it("reads a direct file's kind from the folder it writes to", () => {
    expect(contentOf(file("/root/maps"))).toBe("map");
    expect(contentOf(file("C:\\Spring\\games\\"))).toBe("game");
    expect(contentOf(file("/root/engine"))).toBe("engine");
    expect(contentOf(file("/root/luaui"))).toBe("file");
  });
});

describe("laneOf", () => {
  it("puts a mirror map and a pr-downloader map in the same lane", () => {
    expect(laneOf(file("/root/maps"))).toBe(laneOf(map("Isis")));
  });

  it("puts rapid in the games lane, apart from maps", () => {
    expect(laneOf(rapid)).toBe("games");
    expect(laneOf(game)).toBe("games");
    expect(laneOf(map("Isis"))).toBe("maps");
    expect(laneOf(engine)).toBe("engines");
  });
});

describe("startable", () => {
  const q = (id: string, input: EnqueueInput, status = "queued") => ({
    ...input,
    id,
    status,
  });

  it("starts the first queued item in every free lane", () => {
    const items = [
      q("m1", map("A")),
      q("m2", map("B")),
      q("g1", rapid),
      q("e1", engine),
    ];
    expect(startable(items, new Set()).map((i) => i.id)).toEqual([
      "m1",
      "g1",
      "e1",
    ]);
  });

  it("leaves a busy lane alone", () => {
    const items = [
      q("m1", map("A"), "active"),
      q("m2", map("B")),
      q("g", game),
    ];
    expect(startable(items, new Set(["maps"])).map((i) => i.id)).toEqual(["g"]);
  });
});

describe("parseApacheSize", () => {
  it("reads Apache's powers of 1024", () => {
    expect(parseApacheSize("15M")).toBe(15 * 1024 * 1024);
    expect(parseApacheSize("6.9M")).toBe(Math.round(6.9 * 1024 * 1024));
    expect(parseApacheSize("512K")).toBe(512 * 1024);
    expect(parseApacheSize("1.2G")).toBe(Math.round(1.2 * 1024 ** 3));
    expect(parseApacheSize("900")).toBe(900);
  });

  it("gives up on anything else", () => {
    expect(parseApacheSize("-")).toBeUndefined();
    expect(parseApacheSize("")).toBeUndefined();
    expect(parseApacheSize(undefined)).toBeUndefined();
  });
});

describe("queuedSize", () => {
  it("is null when nothing has a size", () => {
    expect(queuedSize([{}, { sizeBytes: 0 }])).toBeNull();
  });

  it("totals the known sizes and counts the rest", () => {
    expect(queuedSize([{ sizeBytes: 10 }, {}, { sizeBytes: 5 }])).toEqual({
      bytes: 15,
      unknown: 1,
    });
  });
});
