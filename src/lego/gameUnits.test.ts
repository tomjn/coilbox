import { describe, expect, it } from "vitest";
import type { GameItem } from "@/content/bindings";
import type { GameModelRow } from "./gameModels";
import {
  browseSource,
  gameUnitRows,
  pieceLines,
  searchUnitRows,
} from "./gameUnits";
import type { S3oReadPiece } from "./importS3o";
import { type LegoProject, newProject } from "./model";
import { gameRecordFor } from "./unitGame";

function project(extra: Partial<LegoProject> = {}): LegoProject {
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

function game(name: string, archive: string, shortname: string): GameItem {
  return {
    name,
    primaryArchive: { name: archive, path: `/games/${archive}` },
    dependencyArchives: [],
    info: { shortname, version: name.split(" ").pop() ?? "" },
  };
}

const sf86 = game("Splinter Faction 0.1.86", "sf_0.1.86.sdz", "SF");
const sf89 = game("Splinter Faction 0.1.89", "sf_0.1.89.sdz", "SF");
const xta = game("XTA 9.8", "xta_9.8.sdz", "XTA");

describe("browseSource", () => {
  it("asks a unit for no game to choose a game first", () => {
    const source = browseSource(project({ game: null }), [sf86, xta]);
    expect(source).toEqual({
      state: "no-game",
      message: "This unit is for no game. Choose a game first.",
    });
  });

  it("offers the unit's own game", () => {
    const unit = project({ game: gameRecordFor(sf86, [sf86, xta]) });
    expect(browseSource(unit, [sf86, xta])).toEqual({
      state: "ready",
      game: sf86,
    });
  });

  it("offers another installed version of the unit's game, never another game", () => {
    const unit = project({ game: gameRecordFor(sf86, [sf86, xta]) });
    const source = browseSource(unit, [sf89, xta]);
    expect(source).toEqual({ state: "ready", game: sf89 });
  });

  it("says so when the unit's game is not installed, even if others are", () => {
    const unit = project({ game: gameRecordFor(sf86, [sf86, xta]) });
    expect(browseSource(unit, [xta])).toEqual({
      state: "not-installed",
      message: "Splinter Faction 0.1.86 is not installed.",
    });
  });
});

describe("gameUnitRows", () => {
  const rows: GameModelRow[] = [
    { member: "objects3d/armcom.s3o", label: "Commander", unit: "armcom" },
    { member: "objects3d/armcom_dead.s3o", label: "armcom_dead" },
    { member: "objects3d/armllt.s3o", label: "LLT", unit: "armllt" },
  ];

  it("keeps rows a unit names and drops models no unit names", () => {
    expect(gameUnitRows(rows).map((r) => r.label)).toEqual([
      "Commander",
      "LLT",
    ]);
  });

  it("searches by name, by unit name and by model", () => {
    const units = gameUnitRows(rows);
    expect(searchUnitRows(units, "comm").map((r) => r.unit)).toEqual([
      "armcom",
    ]);
    expect(searchUnitRows(units, "ARMLLT").map((r) => r.unit)).toEqual([
      "armllt",
    ]);
    expect(searchUnitRows(units, "armcom.s3o")).toHaveLength(1);
    expect(searchUnitRows(units, "  ")).toHaveLength(2);
    expect(searchUnitRows(units, "nothing")).toEqual([]);
  });
});

describe("pieceLines", () => {
  const piece = (
    name: string,
    children: S3oReadPiece[] = [],
  ): S3oReadPiece => ({
    name,
    primitiveType: 0,
    offset: [0, 0, 0],
    vertices: [],
    indices: [],
    children,
  });

  it("lists pieces depth first with their depth", () => {
    const root = piece("base", [
      piece("turret", [piece("barrel")]),
      piece("leg"),
    ]);
    expect(pieceLines(root)).toEqual([
      { name: "base", depth: 0, path: "0" },
      { name: "turret", depth: 1, path: "0.0" },
      { name: "barrel", depth: 2, path: "0.0.0" },
      { name: "leg", depth: 1, path: "0.1" },
    ]);
  });
});
