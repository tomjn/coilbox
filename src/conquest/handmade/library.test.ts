import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandmadeMapItem } from "../bindings";
import { decodePng } from "./png.testhelper";

const hoisted = vi.hoisted(() => ({
  list: vi.fn(),
  stage: vi.fn(),
  commit: vi.fn(),
  discard: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../bindings", () => ({
  conquestMapList: hoisted.list,
  conquestMapStage: hoisted.stage,
  conquestMapCommit: hoisted.commit,
  conquestMapDiscard: hoisted.discard,
  conquestMapRemove: hoisted.remove,
}));

const SAMPLE = fileURLToPath(
  new URL("../../../docs/examples/handmade-map/", import.meta.url),
);
const manifest = readFileSync(`${SAMPLE}map.json`, "utf8");
const FILES = [
  "cairn.gltf",
  "heightmap.png",
  "map.json",
  "picture.png",
  "provinces.png",
];

// The webview decodes through a canvas. Here the file named last in the URL is
// decoded from the sample folder, and "broken.png" stands for a damaged image.
const pixelsOf = (url: string) => {
  const file = decodeURIComponent(url.split("/").at(-1) ?? "");
  if (file === "broken.png") throw new Error("not an image");
  return decodePng(readFileSync(`${SAMPLE}${file}`));
};
vi.mock("./decode", () => ({
  decodeRgba: async (url: string) => pixelsOf(url),
  imageSize: async (url: string) => {
    const { width, height } = pixelsOf(url);
    return { width, height };
  },
}));

const {
  handmadeMapFileUrls,
  importHandmadeMap,
  listHandmadeMaps,
  loadHandmadeMap,
  removeHandmadeMap,
} = await import("./library");

function item(change: Partial<HandmadeMapItem> = {}): HandmadeMapItem {
  return {
    folder: "sample-two-shores",
    source: "imported",
    manifest,
    files: FILES,
    ...change,
  };
}

const staged = (change: object = {}) => ({
  token: "tok-1",
  id: "sample-two-shores",
  manifest,
  files: FILES,
  skipped: 0,
  ...change,
});

beforeEach(() => {
  for (const mock of Object.values(hoisted)) mock.mockReset();
  hoisted.list.mockResolvedValue({ items: [item()] });
  hoisted.discard.mockResolvedValue({});
  hoisted.remove.mockResolvedValue({});
});

describe("listing hand-made maps", () => {
  it("lists a map from its manifest with a picture to show", async () => {
    const { maps, unreadable } = await listHandmadeMaps();
    expect(unreadable).toEqual([]);
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({
      id: "sample-two-shores",
      game: { shortname: "TG" },
      source: "imported",
      pictureUrl:
        "coilbox://localhost/conquestmap/sample-two-shores/picture.png",
    });
    expect(maps[0].title).not.toBe("");
  });

  it("points a bundled map at its folder beside the app", async () => {
    hoisted.list.mockResolvedValue({
      items: [item({ source: "bundled", folder: "Two Shores" })],
    });
    const { maps } = await listHandmadeMaps();
    expect(maps[0].source).toBe("bundled");
    expect(maps[0].pictureUrl).toBe(
      "coilbox://localhost/portable/galaxies/Two%20Shores/picture.png",
    );
  });

  it("has no picture when the folder has no such file", async () => {
    hoisted.list.mockResolvedValue({
      items: [item({ files: ["map.json", "provinces.png"] })],
    });
    const { maps } = await listHandmadeMaps();
    expect(maps[0].pictureUrl).toBeUndefined();
  });

  it("reports a folder whose manifest does not parse", async () => {
    hoisted.list.mockResolvedValue({
      items: [item({ folder: "bad", manifest: "{ not json" }), item()],
    });
    const { maps, unreadable } = await listHandmadeMaps();
    expect(maps.map((m) => m.id)).toEqual(["sample-two-shores"]);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0].folder).toBe("bad");
    expect(unreadable[0].errors[0].code).toBe("manifest-json");
  });

  it("lists an id once, and the bundled map wins", async () => {
    hoisted.list.mockResolvedValue({
      items: [item(), item({ source: "bundled", folder: "shipped" })],
    });
    const { maps } = await listHandmadeMaps();
    expect(maps.map((m) => m.source)).toEqual(["bundled"]);
  });

  it("does not list an imported folder stored under another name", async () => {
    hoisted.list.mockResolvedValue({ items: [item({ folder: "renamed" })] });
    const { maps, unreadable } = await listHandmadeMaps();
    expect(maps).toEqual([]);
    expect(unreadable[0].errors[0].code).toBe("manifest-field");
  });
});

describe("loading a hand-made map", () => {
  it("reads the sample into a galaxy with URLs for its images", async () => {
    const result = await loadHandmadeMap("sample-two-shores");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.doc.id).toBe("sample-two-shores");
    expect(result.doc.terrain?.image).toBe(
      "coilbox://localhost/conquestmap/sample-two-shores/picture.png",
    );
    expect(result.doc.terrain?.heightmap).toBe(
      "coilbox://localhost/conquestmap/sample-two-shores/heightmap.png",
    );
  });

  it("returns the reader's errors when the map is wrong", async () => {
    // The heightmap is a real file here, so only the reader can object.
    const edited = JSON.parse(manifest);
    edited.files.heightmap = "missing.png";
    hoisted.list.mockResolvedValue({
      items: [item({ manifest: JSON.stringify(edited) })],
    });
    const result = await loadHandmadeMap("sample-two-shores");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({ code: "file-missing", file: "missing.png" }),
    ]);
  });

  it("names a province image the folder does not hold", async () => {
    hoisted.list.mockResolvedValue({
      items: [item({ files: ["map.json", "picture.png"] })],
    });
    const result = await loadHandmadeMap("sample-two-shores");
    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "file-missing",
          file: "provinces.png",
        }),
      ],
    });
  });

  it("names an image that cannot be decoded", async () => {
    const edited = JSON.parse(manifest);
    edited.files.provinces = "broken.png";
    hoisted.list.mockResolvedValue({
      items: [
        item({
          manifest: JSON.stringify(edited),
          files: [...FILES, "broken.png"],
        }),
      ],
    });
    const result = await loadHandmadeMap("sample-two-shores");
    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "image-unreadable",
          file: "broken.png",
        }),
      ],
    });
  });

  it("reports an id no map has", async () => {
    const result = await loadHandmadeMap("nowhere");
    expect(result.ok).toBe(false);
  });
});

describe("the files of a map folder", () => {
  it("resolves a file the folder holds and no other", async () => {
    const result = await loadHandmadeMap("sample-two-shores");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const fileUrl = await handmadeMapFileUrls(result.doc.terrain?.image ?? "");
    expect(fileUrl?.("cairn.gltf")).toBe(
      "coilbox://localhost/conquestmap/sample-two-shores/cairn.gltf",
    );
    expect(fileUrl?.("tower.glb")).toBeUndefined();
  });

  it("resolves inside a bundled map's folder beside the app", async () => {
    hoisted.list.mockResolvedValue({
      items: [
        item({ folder: "other", files: ["map.json", "picture.png"] }),
        item({ source: "bundled", folder: "Two Shores" }),
      ],
    });
    const fileUrl = await handmadeMapFileUrls(
      "coilbox://localhost/portable/galaxies/Two%20Shores/picture.png",
    );
    expect(fileUrl?.("cairn.gltf")).toBe(
      "coilbox://localhost/portable/galaxies/Two%20Shores/cairn.gltf",
    );
  });

  it("has no resolver for a picture no installed map holds", async () => {
    expect(
      await handmadeMapFileUrls("coilbox://localhost/conquestmap/gone/a.png"),
    ).toBeUndefined();
  });
});

describe("importing a hand-made map", () => {
  it("installs a map the reader accepts", async () => {
    hoisted.stage.mockResolvedValue(staged({ skipped: 2 }));
    hoisted.commit.mockResolvedValue({
      status: "imported",
      id: "sample-two-shores",
    });
    const result = await importHandmadeMap("/tmp/map.zip");
    expect(hoisted.stage).toHaveBeenCalledWith({ path: "/tmp/map.zip" });
    expect(hoisted.commit).toHaveBeenCalledWith({
      token: "tok-1",
      replace: false,
    });
    expect(hoisted.discard).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "imported",
      id: "sample-two-shores",
      skipped: 2,
    });
    if (result.status !== "imported") return;
    // The document points at the installed folder, not at staging.
    expect(result.doc.terrain?.image).toBe(
      "coilbox://localhost/conquestmap/sample-two-shores/picture.png",
    );
  });

  it("shows the reader's errors and leaves nothing behind", async () => {
    hoisted.stage.mockResolvedValue(
      staged({ files: ["map.json", "picture.png"] }),
    );
    const result = await importHandmadeMap("/tmp/map.zip");
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "file-missing" })],
    });
    expect(hoisted.commit).not.toHaveBeenCalled();
    expect(hoisted.discard).toHaveBeenCalledWith({ token: "tok-1" });
  });

  it("reports a manifest that is not JSON through the reader", async () => {
    hoisted.stage.mockResolvedValue(staged({ id: "", manifest: "{ nope" }));
    const result = await importHandmadeMap("/tmp/map.zip");
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "manifest-json" })],
    });
    expect(hoisted.discard).toHaveBeenCalledWith({ token: "tok-1" });
  });

  it("asks before replacing a map that is installed", async () => {
    hoisted.stage.mockResolvedValue(staged());
    hoisted.commit.mockResolvedValue({
      status: "exists",
      id: "sample-two-shores",
    });
    const result = await importHandmadeMap("/tmp/map.zip");
    expect(result).toMatchObject({ status: "exists", id: "sample-two-shores" });
    expect(hoisted.discard).toHaveBeenCalledWith({ token: "tok-1" });

    hoisted.commit.mockResolvedValue({
      status: "imported",
      id: "sample-two-shores",
    });
    const again = await importHandmadeMap("/tmp/map.zip", { replace: true });
    expect(hoisted.commit).toHaveBeenLastCalledWith({
      token: "tok-1",
      replace: true,
    });
    expect(again.status).toBe("imported");
  });

  it("passes on the plugin's reason when the zip is refused", async () => {
    hoisted.stage.mockRejectedValue(
      new Error('The zip holds "../x", which points outside the map folder.'),
    );
    const result = await importHandmadeMap("/tmp/map.zip");
    expect(result).toEqual({
      status: "refused",
      message: 'The zip holds "../x", which points outside the map folder.',
    });
    expect(hoisted.discard).not.toHaveBeenCalled();
  });

  it("discards the staged map when the install fails", async () => {
    hoisted.stage.mockResolvedValue(staged());
    hoisted.commit.mockRejectedValue(new Error("Could not install the map."));
    const result = await importHandmadeMap("/tmp/map.zip");
    expect(result).toEqual({
      status: "refused",
      message: "Could not install the map.",
    });
    expect(hoisted.discard).toHaveBeenCalledWith({ token: "tok-1" });
  });

  it("takes the map out again when the installed copy cannot be read", async () => {
    hoisted.stage.mockResolvedValue(staged());
    hoisted.commit.mockResolvedValue({
      status: "imported",
      id: "sample-two-shores",
    });
    // The installed folder lost a file between the install and the read.
    hoisted.list.mockResolvedValue({
      items: [item({ files: ["map.json", "picture.png"] })],
    });
    const result = await importHandmadeMap("/tmp/map.zip");
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "file-missing" })],
    });
    expect(hoisted.remove).toHaveBeenCalledWith({ id: "sample-two-shores" });
  });

  it("says the map is still installed when it cannot be taken out", async () => {
    hoisted.stage.mockResolvedValue(staged());
    hoisted.commit.mockResolvedValue({
      status: "imported",
      id: "sample-two-shores",
    });
    hoisted.list.mockResolvedValue({
      items: [item({ files: ["map.json", "picture.png"] })],
    });
    hoisted.remove.mockRejectedValue(new Error("folder is in use"));
    const result = await importHandmadeMap("/tmp/map.zip");
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.message).toContain(
      'The map was installed as "sample-two-shores"',
    );
    expect(result.message).toContain("folder is in use");
  });
});

describe("removing a hand-made map", () => {
  it("removes by id and lets a refusal through", async () => {
    await removeHandmadeMap("sample-two-shores");
    expect(hoisted.remove).toHaveBeenCalledWith({ id: "sample-two-shores" });

    hoisted.remove.mockRejectedValue(new Error("cannot be removed"));
    await expect(removeHandmadeMap("shipped")).rejects.toThrow(
      "cannot be removed",
    );
  });
});
