import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandmadeMapItem } from "../bindings";
import { decodePng } from "./png.testhelper";

/**
 * Maps a game archive carries (issue #3511), read through a fake unitsync.
 * The fake answers the way the worker does: a tree of member paths, text for
 * text members up to 512 KB, a data URL for images up to 8 MB, and nothing
 * but a kind for anything else. Lookups ignore case, as unitsync's do.
 */

const hoisted = vi.hoisted(() => ({
  list: vi.fn(),
  stage: vi.fn(),
  commit: vi.fn(),
  discard: vi.fn(),
  remove: vi.fn(),
  tree: vi.fn(),
  file: vi.fn(),
  scan: vi.fn(),
}));

vi.mock("../bindings", () => ({
  conquestMapList: hoisted.list,
  conquestMapStage: hoisted.stage,
  conquestMapCommit: hoisted.commit,
  conquestMapDiscard: hoisted.discard,
  conquestMapRemove: hoisted.remove,
}));
vi.mock("../../content/bindings", () => ({
  unitsyncArchiveTree: hoisted.tree,
  unitsyncArchiveFile: hoisted.file,
}));
vi.mock("../../content/config", () => ({ currentScan: hoisted.scan }));

// The webview decodes through a canvas. Here an image URL is a data URL the
// fake unitsync made, or a protocol URL into the sample folder.
const SAMPLE = fileURLToPath(
  new URL("../../../docs/examples/handmade-map/", import.meta.url),
);
const pixelsOf = (url: string) =>
  decodePng(
    url.startsWith("data:")
      ? Buffer.from(url.slice(url.indexOf(",") + 1), "base64")
      : readFileSync(
          `${SAMPLE}${decodeURIComponent(url.split("/").at(-1) ?? "")}`,
        ),
  );
vi.mock("./decode", () => ({
  decodeRgba: async (url: string) => pixelsOf(url),
  imageSize: async (url: string) => {
    const { width, height } = pixelsOf(url);
    return { width, height };
  },
}));

// A data URL is fetched as the webview would. A protocol URL into an
// imported folder is read from the sample folder.
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (url: string) => {
  if (url.startsWith("data:")) return realFetch(url);
  const file = decodeURIComponent(url.split("/").at(-1) ?? "");
  const text = readFileSync(`${SAMPLE}${file}`, "utf8");
  return { ok: true, text: async () => text };
});

const { parseArchiveIndex } = await import("./archive");
const {
  importHandmadeMap,
  listHandmadeMaps,
  loadHandmadeMap,
  setArchiveTarget,
} = await import("./library");
const { handmadeRun, readHandmadeRun } = await import("./conquest");

const sample = (file: string) => readFileSync(`${SAMPLE}${file}`);
/** The sample manifest without its model: models are not read from archives. */
const MANIFEST = (() => {
  const json = JSON.parse(sample("map.json").toString("utf8"));
  delete json.models;
  return JSON.stringify(json);
})();
const SAMPLE_FILES: Record<string, Buffer> = {
  "map.json": Buffer.from(MANIFEST),
  "picture.png": sample("picture.png"),
  "provinces.png": sample("provinces.png"),
  "heightmap.png": sample("heightmap.png"),
  "ironcoast-siege.json": sample("ironcoast-siege.json"),
};

/** Every archive the fake unitsync can open: name, then path to bytes. */
let archives: Record<string, Record<string, Buffer>> = {};

const TEXT_CAP = 512 * 1024;
const IMAGE_CAP = 8 * 1024 * 1024;

function fakeFile({ archive, file }: { archive: string; file: string }) {
  const members = archives[archive] ?? {};
  const key = Object.keys(members).find(
    (p) => p.toLowerCase() === file.toLowerCase(),
  );
  if (key === undefined) {
    return {
      kind: "binary",
      size: 0,
      truncated: false,
      errors: [`could not read member ${file}`],
    };
  }
  const bytes = members[key];
  const ext = file.split(".").at(-1)?.toLowerCase();
  const size = bytes.length;
  if (ext === "json") {
    return size > TEXT_CAP
      ? { kind: "binary", size, truncated: true, errors: [] }
      : {
          kind: "text",
          text: bytes.toString("utf8"),
          size,
          truncated: false,
          errors: [],
        };
  }
  if (ext === "png") {
    return size > IMAGE_CAP
      ? { kind: "binary", size, truncated: true, errors: [] }
      : {
          kind: "image",
          dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
          size,
          truncated: false,
          errors: [],
        };
  }
  return { kind: "binary", size, truncated: false, errors: [] };
}

/** An archive carrying `files` in the map folder `folder`. */
function carrying(
  folder: string,
  files: Record<string, Buffer> = SAMPLE_FILES,
  root = "coilbox/maps",
): Record<string, Buffer> {
  const out: Record<string, Buffer> = {
    "modinfo.lua": Buffer.from("return {}"),
  };
  for (const [name, bytes] of Object.entries(files)) {
    out[`${root}/${folder}/${name}`] = bytes;
  }
  return out;
}

const game = (
  name: string,
  archive: string,
  version: string,
  shortname = "TG",
) => ({
  name,
  primaryArchive: { name: archive },
  dependencyArchives: [],
  info: { shortname, version },
});

let games: ReturnType<typeof game>[] = [];

const TARGET = { enginePath: "/engine", dataDir: "/data" };

function installed(change: Partial<HandmadeMapItem> = {}): HandmadeMapItem {
  return {
    folder: "sample-two-shores",
    source: "imported",
    manifest: MANIFEST,
    files: Object.keys(SAMPLE_FILES),
    ...change,
  };
}

beforeEach(() => {
  for (const mock of Object.values(hoisted)) mock.mockReset();
  archives = { "tg-1.0.sdd": carrying("two-shores") };
  games = [game("Test Game 1.0", "tg-1.0.sdd", "1.0")];
  hoisted.list.mockResolvedValue({ items: [] });
  hoisted.scan.mockImplementation(async () => ({
    games,
    maps: [],
    errors: [],
  }));
  hoisted.tree.mockImplementation(async ({ archive }: { archive: string }) => ({
    files: Object.entries(archives[archive] ?? {}).map(([path, b]) => ({
      path,
      size: b.length,
    })),
    errors: [],
  }));
  hoisted.file.mockImplementation(
    async (args: { archive: string; file: string }) => fakeFile(args),
  );
  hoisted.discard.mockResolvedValue({});
  setArchiveTarget(TARGET);
});

describe("listing the maps a game archive carries", () => {
  it("lists a map a loose .sdd carries, for that game", async () => {
    const { maps, unreadable } = await listHandmadeMaps();
    expect(unreadable).toEqual([]);
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({
      id: "sample-two-shores",
      title: "Two Shores",
      game: { shortname: "TG" },
      source: "game",
      carriedBy: "Test Game 1.0",
      warpath: true,
    });
    expect(maps[0].pictureUrl).toMatch(/^data:image\/png;base64,/);
    expect(hoisted.tree).toHaveBeenCalledWith({
      ...TARGET,
      archive: "tg-1.0.sdd",
    });
  });

  it("lists the same map from a packaged .sdz", async () => {
    archives = { "tg-1.0.sdz": carrying("two-shores") };
    games = [game("Test Game 1.0", "tg-1.0.sdz", "1.0")];
    const { maps } = await listHandmadeMaps();
    expect(maps.map((m) => [m.id, m.carriedBy])).toEqual([
      ["sample-two-shores", "Test Game 1.0"],
    ]);
  });

  it("finds the folder whatever the case of its path", async () => {
    archives = {
      "tg-1.0.sdd": carrying("two-shores", SAMPLE_FILES, "Coilbox/Maps"),
    };
    const { maps } = await listHandmadeMaps();
    expect(maps.map((m) => m.id)).toEqual(["sample-two-shores"]);
  });

  it("ignores a map.json anywhere but a folder under coilbox/maps", async () => {
    archives = {
      "tg-1.0.sdd": {
        ...carrying("two-shores", SAMPLE_FILES, "maps"),
        "coilbox/maps/map.json": Buffer.from(MANIFEST),
      },
    };
    const { maps, unreadable } = await listHandmadeMaps();
    expect(maps).toEqual([]);
    expect(unreadable).toEqual([]);
  });

  it("takes a map two versions carry from the newer one", async () => {
    archives = {
      "tg-1.0.sdd": carrying("two-shores"),
      "tg-2.0.sdz": carrying("two-shores"),
    };
    games = [
      game("Test Game 1.0", "tg-1.0.sdd", "1.0"),
      game("Test Game 2.0", "tg-2.0.sdz", "2.0"),
    ];
    const { maps } = await listHandmadeMaps();
    expect(maps.map((m) => m.carriedBy)).toEqual(["Test Game 2.0"]);
  });

  it("refuses a map whose game is not the one carrying it", async () => {
    games = [game("Other Game 1.0", "tg-1.0.sdd", "1.0", "OG")];
    const { maps, unreadable } = await listHandmadeMaps();
    expect(maps).toEqual([]);
    expect(unreadable).toMatchObject([
      {
        folder: "two-shores",
        source: "game",
        carriedBy: "Other Game 1.0",
        errors: [{ code: "manifest-field", path: "game.shortname" }],
      },
    ]);
  });

  it("lists a folder whose map.json is not JSON as unreadable", async () => {
    archives = {
      "tg-1.0.sdd": carrying("two-shores", {
        ...SAMPLE_FILES,
        "map.json": Buffer.from("{ not json"),
      }),
    };
    const { unreadable } = await listHandmadeMaps();
    expect(unreadable).toMatchObject([
      {
        folder: "two-shores",
        carriedBy: "Test Game 1.0",
        errors: [{ code: "manifest-json" }],
      },
    ]);
  });

  it("searches no archive when there is no engine", async () => {
    setArchiveTarget(null);
    const { maps } = await listHandmadeMaps();
    expect(maps).toEqual([]);
    expect(hoisted.scan).not.toHaveBeenCalled();
    expect(hoisted.tree).not.toHaveBeenCalled();
  });

  it("says why when the installed games cannot be listed", async () => {
    hoisted.scan.mockRejectedValue(new Error("Init failed"));
    hoisted.list.mockResolvedValue({ items: [installed()] });
    const list = await listHandmadeMaps();
    expect(list.archiveError).toBe("Init failed");
    // Maps from the other sources are still listed.
    expect(list.maps.map((m) => m.source)).toEqual(["imported"]);
  });
});

describe("which map is seen when two sources share an id", () => {
  it("shows the game's map over an imported one", async () => {
    hoisted.list.mockResolvedValue({ items: [installed()] });
    const { maps } = await listHandmadeMaps();
    expect(maps.map((m) => m.source)).toEqual(["game"]);
  });

  it("shows a bundled map over the game's", async () => {
    hoisted.list.mockResolvedValue({
      items: [installed({ source: "bundled", folder: "Two Shores" })],
    });
    const { maps } = await listHandmadeMaps();
    expect(maps.map((m) => m.source)).toEqual(["bundled"]);
  });

  it("refuses to import a map whose id a game carries", async () => {
    hoisted.stage.mockResolvedValue({
      token: "tok-1",
      id: "sample-two-shores",
      manifest: MANIFEST,
      files: Object.keys(SAMPLE_FILES),
      skipped: 0,
    });
    const result = await importHandmadeMap("/maps/two-shores.zip");
    expect(result).toEqual({
      status: "refused",
      message:
        'The game "Test Game 1.0" carries a map with the id "sample-two-shores", and a map a game carries cannot be replaced. Change the id in map.json and import it again.',
    });
    expect(hoisted.commit).not.toHaveBeenCalled();
    expect(hoisted.discard).toHaveBeenCalledWith({ token: "tok-1" });
  });
});

describe("reading a map a game carries", () => {
  it("reads it into a document that names the game", async () => {
    const result = await loadHandmadeMap("sample-two-shores");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.doc.title).toBe("Two Shores");
    expect(result.doc.handmade).toMatchObject({
      mapId: "sample-two-shores",
      carriedBy: "Test Game 1.0",
    });
    expect(result.doc.handmade?.fingerprint).toBeTruthy();
    expect(result.doc.terrain?.image).toMatch(/^data:image\/png;base64,/);
    expect(result.doc.terrain?.heightmap).toMatch(/^data:image\/png;base64,/);
    // The scenario file was read out of the archive too.
    expect(
      result.doc.nodes.find((n) => n.id === "ironcoast")?.scenario,
    ).toBeTruthy();
  });

  it("reads the same map from a packaged .sdz", async () => {
    archives = { "tg-1.0.sdz": carrying("two-shores") };
    games = [game("Test Game 1.0", "tg-1.0.sdz", "1.0")];
    const result = await loadHandmadeMap("sample-two-shores");
    expect(result.ok).toBe(true);
  });

  it("gives the same fingerprint as the same map imported", async () => {
    const carried = await loadHandmadeMap("sample-two-shores");
    setArchiveTarget(null);
    hoisted.list.mockResolvedValue({ items: [installed()] });
    const imported = await loadHandmadeMap("sample-two-shores");
    if (!carried.ok || !imported.ok) throw new Error("both should read");
    expect(carried.doc.handmade?.fingerprint).toBe(
      imported.doc.handmade?.fingerprint,
    );
  });

  it("says a model file cannot be read from a game archive", async () => {
    const json = JSON.parse(MANIFEST);
    json.models = [{ model: { file: "cairn.gltf" }, pos: [440, 600] }];
    archives = {
      "tg-1.0.sdd": carrying("two-shores", {
        ...SAMPLE_FILES,
        "map.json": Buffer.from(JSON.stringify(json)),
        "cairn.gltf": sample("cairn.gltf"),
      }),
    };
    const result = await loadHandmadeMap("sample-two-shores");
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "archive-unreadable",
          file: "cairn.gltf",
          message:
            '"cairn.gltf" is in the game archive, but coilbox cannot read model files from a game archive yet. Leave models out of a map the game carries.',
        },
      ],
    });
  });

  it("says an image is too large to read from a game archive", async () => {
    archives = {
      "tg-1.0.sdd": carrying("two-shores", {
        ...SAMPLE_FILES,
        "picture.png": Buffer.alloc(IMAGE_CAP + 1),
      }),
    };
    const result = await loadHandmadeMap("sample-two-shores");
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "archive-unreadable", file: "picture.png" }],
    });
    if (result.ok) return;
    expect(result.errors[0].message).toMatch(/too large/);
  });

  it("leaves a file the folder lacks for the reader to report", async () => {
    const { "heightmap.png": _, ...rest } = SAMPLE_FILES;
    archives = { "tg-1.0.sdd": carrying("two-shores", rest) };
    const result = await loadHandmadeMap("sample-two-shores");
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "file-missing", file: "heightmap.png" }],
    });
  });

  it("says a game update may have removed a map no source has", async () => {
    archives = {};
    const result = await loadHandmadeMap("sample-two-shores");
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "file-missing",
          file: "map.json",
          message:
            'No hand-made map with the id "sample-two-shores" is installed, and no installed game carries one. A game update may have removed it.',
        },
      ],
    });
  });
});

describe("reading the archives again", () => {
  it("reads each file once for one target", async () => {
    await listHandmadeMaps();
    await loadHandmadeMap("sample-two-shores");
    await loadHandmadeMap("sample-two-shores");
    expect(hoisted.tree).toHaveBeenCalledTimes(1);
    const files = hoisted.file.mock.calls.map(([a]) => a.file);
    expect(files.length).toBe(new Set(files).size);
  });

  it("sees a loose .sdd edited in place once the target is set again", async () => {
    await listHandmadeMaps();
    const json = JSON.parse(MANIFEST);
    json.title = "Two Shores, revised";
    archives["tg-1.0.sdd"]["coilbox/maps/two-shores/map.json"] = Buffer.from(
      JSON.stringify(json),
    );
    expect((await listHandmadeMaps()).maps[0].title).toBe("Two Shores");
    setArchiveTarget(TARGET);
    expect((await listHandmadeMaps()).maps[0].title).toBe(
      "Two Shores, revised",
    );
  });

  it("drops a map a game update removed", async () => {
    await listHandmadeMaps();
    archives = { "tg-1.1.sdz": { "modinfo.lua": Buffer.from("return {}") } };
    games = [game("Test Game 1.1", "tg-1.1.sdz", "1.1")];
    setArchiveTarget(TARGET);
    expect((await listHandmadeMaps()).maps).toEqual([]);
  });
});

describe("the game asking for its own maps only", () => {
  const withIndex = (text: string, files = SAMPLE_FILES) => ({
    ...carrying("two-shores", files),
    "coilbox/maps/index.json": Buffer.from(text),
  });

  it("names the game when its index.json says so", async () => {
    archives = { "tg-1.0.sdd": withIndex('{ "onlyOwnMaps": true }') };
    const list = await listHandmadeMaps();
    expect(list.onlyOwnMaps).toEqual(["Test Game 1.0"]);
    expect(list.unreadable).toEqual([]);
  });

  it("names no game without the flag", async () => {
    archives = { "tg-1.0.sdd": withIndex('{ "onlyOwnMaps": false }') };
    expect((await listHandmadeMaps()).onlyOwnMaps).toEqual([]);
  });

  it("names no game whose maps all fail to list", async () => {
    archives = {
      "tg-1.0.sdd": withIndex('{ "onlyOwnMaps": true }', {
        ...SAMPLE_FILES,
        "map.json": Buffer.from("{ not json"),
      }),
    };
    expect((await listHandmadeMaps()).onlyOwnMaps).toEqual([]);
  });

  it("lists a broken index.json as unreadable and leaves the styles on", async () => {
    archives = { "tg-1.0.sdd": withIndex('{ "onlyOwnMaps": "yes" }') };
    const list = await listHandmadeMaps();
    expect(list.onlyOwnMaps).toEqual([]);
    expect(list.unreadable).toMatchObject([
      {
        folder: "index.json",
        carriedBy: "Test Game 1.0",
        errors: [{ path: "onlyOwnMaps" }],
      },
    ]);
  });

  it("reads the flag and nothing else", () => {
    expect(parseArchiveIndex('{ "onlyOwnMaps": true, "later": 1 }')).toEqual({
      onlyOwnMaps: true,
      errors: [],
    });
    expect(parseArchiveIndex("{}")).toEqual({ onlyOwnMaps: false, errors: [] });
    expect(parseArchiveIndex("[]").errors).toMatchObject([
      { code: "manifest-json" },
    ]);
    expect(parseArchiveIndex("nope").errors).toMatchObject([
      { code: "manifest-json" },
    ]);
  });
});

describe("a conquest on a map a game carries", () => {
  it("saves the game, so a save can say a game update took the map", async () => {
    const result = await loadHandmadeMap("sample-two-shores");
    if (!result.ok) throw new Error("should read");
    const run = handmadeRun(
      result.doc,
      { seed: 1, fogOfWar: false, threatLevel: 0 },
      [],
    );
    expect(run.carriedBy).toBe("Test Game 1.0");
    const state = { handmade: run } as Parameters<typeof readHandmadeRun>[0];
    expect(readHandmadeRun(state)?.carriedBy).toBe("Test Game 1.0");
  });
});
