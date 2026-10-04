import { describe, expect, it } from "vitest";
import { parseGalaxyJson, wrapGalaxyForExport } from "./model";
import { parsePlacedModels } from "./placedModels";

describe("parsePlacedModels", () => {
  it("reads both kinds of model with every field", () => {
    expect(
      parsePlacedModels([
        {
          model: { game: "features/pinetree.s3o" },
          pos: [10, 20],
          height: 5,
          rotation: 90,
          scale: 2,
        },
        { model: { file: "props/gate.glb" }, pos: [1, 2] },
      ]),
    ).toEqual([
      {
        model: { game: "features/pinetree.s3o" },
        pos: [10, 20],
        height: 5,
        rotation: 90,
        scale: 2,
      },
      { model: { file: "props/gate.glb" }, pos: [1, 2] },
    ]);
  });

  it("reads anything but a non-empty list as absent", () => {
    expect(parsePlacedModels(undefined)).toBeUndefined();
    expect(parsePlacedModels("trees")).toBeUndefined();
    expect(parsePlacedModels([])).toBeUndefined();
    expect(parsePlacedModels([null, 3, {}])).toBeUndefined();
  });

  it("drops an entry whose model reference is not exactly one kind", () => {
    const pos = [0, 0];
    expect(
      parsePlacedModels([
        { model: { game: "tree", file: "tree.glb" }, pos },
        { model: {}, pos },
        { model: "tree", pos },
        { model: { game: "  " }, pos },
        { model: { game: 4 }, pos },
      ]),
    ).toBeUndefined();
  });

  it("keeps a file reference inside the map folder and to glTF", () => {
    const pos = [0, 0];
    const names = (files: string[]) =>
      parsePlacedModels(files.map((file) => ({ model: { file }, pos })))?.map(
        (m) => m.model,
      );
    expect(names(["a.gltf", "sub/B.GLB"])).toEqual([
      { file: "a.gltf" },
      { file: "sub/B.GLB" },
    ]);
    expect(
      names([
        "../a.glb",
        "sub/../../a.glb",
        "/etc/a.glb",
        "C:\\a.glb",
        "https://example.com/a.glb",
        "sub//a.glb",
        "a.s3o",
        "",
      ]),
    ).toBeUndefined();
  });

  it("drops an entry without a usable position", () => {
    const model = { game: "tree" };
    expect(
      parsePlacedModels([
        { model },
        { model, pos: [1] },
        { model, pos: [1, Number.NaN] },
        { model, pos: ["1", 2] },
      ]),
    ).toBeUndefined();
  });

  it("drops a malformed optional field and keeps the entry", () => {
    expect(
      parsePlacedModels([
        {
          model: { game: "tree" },
          pos: [1, 2],
          height: "high",
          rotation: Number.POSITIVE_INFINITY,
          scale: 0,
        },
        { model: { game: "tree" }, pos: [3, 4], scale: -1 },
      ]),
    ).toEqual([
      { model: { game: "tree" }, pos: [1, 2] },
      { model: { game: "tree" }, pos: [3, 4] },
    ]);
  });
});

describe("placed models on a map document", () => {
  const doc = {
    schemaVersion: 1,
    id: "g",
    type: "conquest-galaxy",
    title: "G",
    description: "",
    game: { shortname: "TG" },
    playerFactionId: "p",
    factions: [{ id: "p", name: "Player", color: "#4f8cff" }],
    nodes: [
      {
        id: "a",
        name: "A",
        pos: [0, 0],
        owner: "p",
        kind: "capital",
        difficulty: 1,
        battle: { mapName: "MapA" },
      },
    ],
    links: [],
    createdAt: "",
    updatedAt: "",
  };
  const models = [
    { model: { game: "tree" }, pos: [5, 6], rotation: 45 },
    { model: { file: "gate.glb" }, pos: [7, 8], height: 2, scale: 3 },
  ];

  it("is parsed by parseGalaxyJson and survives an export", () => {
    const parsed = parseGalaxyJson(JSON.stringify({ ...doc, models }));
    expect(parsed?.models).toEqual(models);
    if (!parsed) return;
    const exported = JSON.stringify(wrapGalaxyForExport(parsed));
    expect(parseGalaxyJson(exported)?.models).toEqual(models);
  });

  it("is absent on a document that places none", () => {
    expect(parseGalaxyJson(JSON.stringify(doc))?.models).toBeUndefined();
  });
});
