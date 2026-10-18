// @vitest-environment happy-dom

/**
 * The game unit browser (issue #3264): which game it reads, what it lists, and
 * the piece tree of a unit opened in it. Unitsync is replaced with fixed
 * answers, because what is under test is which archive is asked about and what
 * is drawn from the answer.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameItem } from "@/content/bindings";
import { type LegoProject, newProject } from "../../model";
import { gameRecordFor } from "../../unitGame";

const mocks = vi.hoisted(() => ({
  games: [] as unknown[],
  datasetArchives: [] as (string | undefined)[],
  readS3o: vi.fn(),
  importS3o: vi.fn(),
  read3do: vi.fn(),
  import3do: vi.fn(),
  readDae: vi.fn(),
  importDae: vi.fn(),
  trim: vi.fn(),
  stageTextures: vi.fn(),
  adopt: vi.fn(),
}));

vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
}));

vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({
    data: { games: mocks.games },
    loading: false,
    error: null,
  }),
  useUnitsyncArchiveTree: (_e?: string, _d?: string, archive?: string) => ({
    tree: archive
      ? {
          archivePath: `/games/${archive}`,
          files: [
            { path: "objects3d/armcom.s3o" },
            { path: "objects3d/armcom_dead.s3o" },
            { path: "objects3d/armllt.s3o" },
            { path: "objects3d/armfus.3do" },
            { path: "objects3d/armsolar.dae" },
          ],
        }
      : null,
    loading: false,
  }),
  useUnitsyncUnitDataset: (_e?: string, _d?: string, archive?: string) => {
    mocks.datasetArchives.push(archive);
    return {
      status: "ready",
      dataset: archive
        ? {
            units: [
              {
                name: "armcom",
                fullName: "Commander",
                objectName: "armcom",
              },
              { name: "armllt", fullName: "LLT", objectName: "armllt" },
              { name: "armfus", fullName: "Fusion", objectName: "armfus" },
              { name: "armsolar", fullName: "Solar", objectName: "armsolar" },
            ],
          }
        : null,
    };
  },
  useUnitsyncUnitBuildpics: () => ({ units: {} }),
}));

vi.mock("../../gameImport", () => ({
  stageModel: async (_t: unknown, picked: { member: string }) => ({
    path: `/tmp/${picked.member}`,
    staged: "/tmp",
  }),
  stageTextures: (...args: unknown[]) => mocks.stageTextures(...args),
  modelSource: (picked: { archive: string; member: string }) =>
    `${picked.archive}/${picked.member}`,
}));

vi.mock("../../adoptGameScript", () => ({
  adoptGameScript: (...args: unknown[]) => mocks.adopt(...args),
}));

vi.mock("../../bindings", () => ({
  legoReadS3o: (args: unknown) => mocks.readS3o(args),
  legoImportS3o: (args: unknown) => mocks.importS3o(args),
  legoRead3do: (args: unknown) => mocks.read3do(args),
  legoImport3do: (args: unknown) => mocks.import3do(args),
  legoReadDae: (args: unknown) => mocks.readDae(args),
  legoImportDae: (args: unknown) => mocks.importDae(args),
}));

vi.mock("../../liftIntoUnit", () => ({
  trimLiftedMeshes: (module: unknown) => mocks.trim(module),
}));

import { GameUnitBrowser } from "./GameUnitBrowser";

function game(name: string, archive: string, shortname: string): GameItem {
  return {
    name,
    primaryArchive: { name: archive, path: `/games/${archive}` },
    dependencyArchives: [],
    info: { shortname, version: "1" },
  };
}

const sf = game("Splinter Faction 0.1.86", "sf.sdz", "SF");
const xta = game("XTA 9.8", "xta.sdz", "XTA");

function unit(extra: Partial<LegoProject> = {}): LegoProject {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Rover",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-17T00:00:00Z",
    }),
    ...extra,
  };
}

const piece = (name: string, children: unknown[] = []) => ({
  name,
  children,
});

const imported = (
  name: string,
  meshId: string | null,
  children: unknown[] = [],
) => ({ name, offset: [0, 0, 0], meshId, children });

const importResult = (root: unknown) => ({
  radius: 1,
  height: 1,
  mid: [0, 0, 0],
  root,
  texture: { key: "aa.png", name: "sheet.png", source: null },
  texture2: { key: null, name: "", source: null },
  meshes: 3,
  vertices: 9,
  triangles: 3,
  converted: 0,
  bytes: 10,
});

beforeEach(() => {
  mocks.games = [sf, xta];
  mocks.datasetArchives = [];
  mocks.readS3o.mockReset();
  mocks.importS3o.mockReset();
  mocks.read3do.mockReset();
  mocks.import3do.mockReset();
  mocks.readDae.mockReset();
  mocks.importDae.mockReset();
  mocks.trim.mockReset();
  mocks.trim.mockResolvedValue(null);
  mocks.stageTextures.mockReset();
  mocks.adopt.mockReset();
  mocks.adopt.mockResolvedValue({ findings: null });
  mocks.stageTextures.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("GameUnitBrowser", () => {
  it("asks a unit for no game to choose one first, and reads nothing", () => {
    render(<GameUnitBrowser project={unit({ game: null })} query="" />);
    expect(
      screen.getByText("This unit is for no game. Choose a game first."),
    ).toBeTruthy();
    expect(mocks.datasetArchives.every((a) => a === undefined)).toBe(true);
  });

  it("says when the unit's game is not installed", () => {
    mocks.games = [xta];
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="" />);
    expect(
      screen.getByText("Splinter Faction 0.1.86 is not installed."),
    ).toBeTruthy();
    expect(mocks.datasetArchives.every((a) => a === undefined)).toBe(true);
  });

  it("lists the unit's own game's units by name and reads no other game", () => {
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="" />);
    expect(screen.getByText("Commander")).toBeTruthy();
    expect(screen.getByText("LLT")).toBeTruthy();
    // A model no unit names is a wreck, not a unit.
    expect(screen.queryByText("armcom_dead")).toBeNull();
    expect(mocks.datasetArchives.filter(Boolean)).not.toContain("xta.sdz");
    expect(mocks.datasetArchives.filter(Boolean)).toContain("sf.sdz");
  });

  it("narrows the list by the search", () => {
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="llt" />);
    expect(screen.getByText("LLT")).toBeTruthy();
    expect(screen.queryByText("Commander")).toBeNull();
  });

  it("opens a unit to its piece tree", async () => {
    mocks.readS3o.mockResolvedValue({
      root: piece("base", [piece("turret", [piece("barrel")])]),
    });
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="" />);
    fireEvent.click(screen.getByRole("button", { name: /Commander/ }));
    await waitFor(() => expect(screen.getByText("barrel")).toBeTruthy());
    expect(screen.getByText("base")).toBeTruthy();
    expect(screen.getByText("turret")).toBeTruthy();
    expect(mocks.readS3o).toHaveBeenCalledWith({
      path: "/tmp/objects3d/armcom.s3o",
    });
  });

  it("says plainly when the read fails", async () => {
    mocks.readS3o.mockRejectedValue(new Error("bad header"));
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="" />);
    fireEvent.click(screen.getByRole("button", { name: /Commander/ }));
    await waitFor(() => expect(screen.getByText(/bad header/)).toBeTruthy());
  });

  it("lists the pieces of a .3do from its import, after staging its tiles", async () => {
    mocks.read3do.mockResolvedValue({ textures: ["tile1", "tile100"] });
    mocks.import3do.mockResolvedValue(
      importResult(imported("base", "m0", [imported("lamp", "m1")])),
    );
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="" />);
    fireEvent.click(screen.getByRole("button", { name: /Fusion/ }));
    await waitFor(() => expect(screen.getByText("lamp")).toBeTruthy());
    expect(mocks.read3do).toHaveBeenCalledWith({
      path: "/tmp/objects3d/armfus.3do",
    });
    expect(mocks.stageTextures.mock.calls[0][4]).toEqual(["tile1", "tile100"]);
    expect(mocks.readS3o).not.toHaveBeenCalled();
  });

  it("lists the pieces of a .dae from its import", async () => {
    mocks.readDae.mockResolvedValue({ textures: ["solar.png"] });
    mocks.importDae.mockResolvedValue(
      importResult(imported("base", "m0", [imported("panel", "m1")])),
    );
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="" />);
    fireEvent.click(screen.getByRole("button", { name: /Solar/ }));
    await waitFor(() => expect(screen.getByText("panel")).toBeTruthy());
    expect(mocks.readS3o).not.toHaveBeenCalled();
  });

  it("offers a .3do piece the import dropped no line for", async () => {
    mocks.read3do.mockResolvedValue({ textures: [] });
    // The import left out a duplicate "arm" under "base".
    mocks.import3do.mockResolvedValue({
      ...importResult(imported("base", "m0", [imported("arm", "m1")])),
      droppedPieces: 1,
    });
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="" />);
    fireEvent.click(screen.getByRole("button", { name: /Fusion/ }));
    await screen.findByText("arm");
    expect(screen.getAllByText("arm")).toHaveLength(1);
  });

  describe("lifting a piece", () => {
    function openCommander(onLift: (compound: LegoProject) => Promise<void>) {
      mocks.readS3o.mockResolvedValue({
        texture1: "arm_1.dds",
        texture2: "arm_2.dds",
        root: piece("base", [piece("turret", [piece("barrel")])]),
      });
      mocks.importS3o.mockResolvedValue({
        radius: 1,
        height: 1,
        mid: [0, 0, 0],
        root: imported("base", "m0", [
          imported("turret", "m1", [imported("barrel", "m2")]),
        ]),
        texture: { key: "aa.dds", name: "arm_1.dds", source: null },
        texture2: { key: null, name: "", source: null },
        meshes: 3,
        vertices: 9,
        triangles: 3,
        converted: 0,
        bytes: 10,
      });
      const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
      render(<GameUnitBrowser project={project} query="" onLift={onLift} />);
      fireEvent.click(screen.getByRole("button", { name: /Commander/ }));
    }

    it("lifts the piece and everything under it into the inventory", async () => {
      const onLift = vi.fn(async (_compound: LegoProject) => {});
      openCommander(onLift);
      const lift = await screen.findByRole("button", {
        name: "Lift turret into the inventory",
      });
      fireEvent.click(lift);
      await waitFor(() => expect(onLift).toHaveBeenCalledTimes(1));

      const compound = onLift.mock.calls[0][0];
      expect(compound.pieces.map((p) => p.name)).toEqual(["turret", "barrel"]);
      expect(
        compound.pieces.every((p) => p.lifted?.game.shortname === "SF"),
      ).toBe(true);
      expect(compound.pieces[0].lifted?.unit).toBe("armcom");
      // The geometry is stored under the module's own id.
      expect(mocks.importS3o).toHaveBeenCalledWith({
        path: "/tmp/objects3d/armcom.s3o",
        id: compound.id,
      });
      expect(mocks.stageTextures).toHaveBeenCalled();
      expect(await screen.findByText(/^Lifted\./)).toBeTruthy();
    });

    it.each([
      ["Fusion", "read3do", "import3do", "/tmp/objects3d/armfus.3do", "armfus"],
      [
        "Solar",
        "readDae",
        "importDae",
        "/tmp/objects3d/armsolar.dae",
        "armsolar",
      ],
    ] as const)("lifts a piece off %s with its subtree, textures and trimmed geometry", async (label, read, imp, path, unitName) => {
      mocks[read].mockResolvedValue({ textures: ["tileA"] });
      mocks[imp].mockResolvedValue(
        importResult(
          imported("base", "m0", [
            imported("turret", "m1", [imported("barrel", "m2")]),
          ]),
        ),
      );
      const onLift = vi.fn(async (_compound: LegoProject) => {});
      const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
      render(<GameUnitBrowser project={project} query="" onLift={onLift} />);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Lift turret into the inventory",
        }),
      );
      await waitFor(() => expect(onLift).toHaveBeenCalledTimes(1));

      const compound = onLift.mock.calls[0][0];
      expect(compound.pieces.map((p) => p.name)).toEqual(["turret", "barrel"]);
      expect(
        compound.pieces.every((p) => p.lifted?.game.shortname === "SF"),
      ).toBe(true);
      expect(compound.pieces[0].lifted?.unit).toBe(unitName);
      expect(compound.pieces[0].lifted?.texture?.key).toBe("aa.png");
      // The lift imports under the module's own id, then trims to its meshes.
      expect(mocks[imp]).toHaveBeenLastCalledWith({ path, id: compound.id });
      expect(mocks.trim).toHaveBeenCalledWith(
        expect.objectContaining({ id: compound.id }),
      );
      expect(mocks.stageTextures.mock.calls.at(-1)?.[4]).toEqual(["tileA"]);
    });

    it("trims an .s3o lift the same way", async () => {
      const onLift = vi.fn(async (_compound: LegoProject) => {});
      openCommander(onLift);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Lift turret into the inventory",
        }),
      );
      await waitFor(() => expect(onLift).toHaveBeenCalledTimes(1));
      expect(mocks.trim).toHaveBeenCalledTimes(1);
    });

    it("brings the roles the unit's script gives the lifted pieces", async () => {
      mocks.adopt.mockResolvedValue({
        findings: {
          proposals: [
            {
              pieceName: "turret",
              role: "turret",
              evidence: "observed",
              callin: "AimWeapon1",
            },
            {
              pieceName: "barrel",
              role: "barrel",
              evidence: "observed",
              callin: "AimWeapon1",
            },
          ],
        },
      });
      const onLift = vi.fn(async (_compound: LegoProject) => {});
      openCommander(onLift);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Lift turret into the inventory",
        }),
      );
      await waitFor(() => expect(onLift).toHaveBeenCalledTimes(1));
      const compound = onLift.mock.calls[0][0];
      expect(compound.pieces.map((p) => p.role)).toEqual(["turret", "barrel"]);
      expect(compound.animations?.map((a) => a.presetId)).toEqual([
        "turret.track",
        "recoil",
      ]);
      expect(mocks.adopt.mock.calls[0][0].imported.game.unit).toBe("armcom");
      expect(
        await screen.findByText("Lifted. Roles: Turret, Barrel."),
      ).toBeTruthy();
    });

    it("falls back to piece names when the script cannot be read", async () => {
      mocks.adopt.mockRejectedValue(new Error("no archive"));
      const onLift = vi.fn(async (_compound: LegoProject) => {});
      openCommander(onLift);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Lift turret into the inventory",
        }),
      );
      await waitFor(() => expect(onLift).toHaveBeenCalledTimes(1));
      expect(onLift.mock.calls[0][0].pieces.map((p) => p.role)).toEqual([
        "turret",
        "barrel",
      ]);
    });

    it("says why when the lift fails", async () => {
      const onLift = vi.fn(async () => {
        throw new Error("disk full");
      });
      openCommander(onLift);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Lift barrel into the inventory",
        }),
      );
      expect(await screen.findByText(/disk full/)).toBeTruthy();
    });

    it("offers no lift where the page cannot keep one", async () => {
      mocks.readS3o.mockResolvedValue({ root: piece("base") });
      const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
      render(<GameUnitBrowser project={project} query="" />);
      fireEvent.click(screen.getByRole("button", { name: /Commander/ }));
      await screen.findByText("base");
      expect(screen.queryByRole("button", { name: /^Lift / })).toBeNull();
    });
  });
});

/** A game unit's script, imported into the unit being built (#643). */
describe("using a game unit's script", () => {
  async function openCommander(onUseScript = vi.fn()) {
    mocks.readS3o.mockResolvedValue({ root: piece("base") });
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(
      <GameUnitBrowser project={project} query="" onUseScript={onUseScript} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Commander/ }));
    await waitFor(() => expect(screen.getByText("base")).toBeTruthy());
    return onUseScript;
  }

  it("reads that unit's script and hands it over with what it reads", async () => {
    mocks.adopt.mockResolvedValue({
      script: "-- armcom",
      kind: "lua",
      includes: { "lib.lua": "return {}" },
      unitDef: { name: "armcom" },
      notes: [],
    });
    const onUseScript = await openCommander();

    fireEvent.click(screen.getByRole("button", { name: /Use its script/ }));

    await waitFor(() => expect(onUseScript).toHaveBeenCalled());
    expect(onUseScript).toHaveBeenCalledWith("-- armcom", {
      includes: { "lib.lua": "return {}" },
      unitDef: { name: "armcom" },
    });
    expect(mocks.adopt.mock.calls[0][0].imported.game).toMatchObject({
      archive: "sf.sdz",
      unit: "armcom",
    });
  });

  it("says why when the unit has no script to import", async () => {
    mocks.adopt.mockResolvedValue({
      script: null,
      kind: "cob",
      includes: {},
      unitDef: null,
      notes: [],
    });
    const onUseScript = await openCommander();

    fireEvent.click(screen.getByRole("button", { name: /Use its script/ }));

    expect(
      await screen.findByText("armcom has only a compiled script."),
    ).toBeTruthy();
    expect(onUseScript).not.toHaveBeenCalled();
  });
});
