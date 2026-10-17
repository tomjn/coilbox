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
    staged: null,
  }),
}));

vi.mock("../../bindings", () => ({
  legoReadS3o: (args: unknown) => mocks.readS3o(args),
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

beforeEach(() => {
  mocks.games = [sf, xta];
  mocks.datasetArchives = [];
  mocks.readS3o.mockReset();
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

  it("does not try to list the pieces of a model that is not an .s3o", () => {
    const project = unit({ game: gameRecordFor(sf, [sf, xta]) });
    render(<GameUnitBrowser project={project} query="" />);
    fireEvent.click(screen.getByRole("button", { name: /Fusion/ }));
    expect(screen.getByText(/only for .s3o models/)).toBeTruthy();
    expect(mocks.readS3o).not.toHaveBeenCalled();
  });
});
