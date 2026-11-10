// @vitest-environment happy-dom
/**
 * The skeleton widget's scan (#5186): it reads a game's units, lists each with
 * how much of a plan it got, links one with none to the builder, writes the
 * file, and stops when asked.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameItem } from "@/content/bindings";
import { type LegoPiece, newProject } from "@/lego/model";
import type { ScanDeps } from "@/lego/skeletonScan";

const files = new Map<string, string>();
vi.mock("@/blueprint/fileIO", () => ({
  appFileIO: {
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, text: string) => {
      files.set(path, text);
    },
  },
}));

vi.mock("@/content/bindings", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  unitsyncArchiveTree: async () => ({
    files: [{ path: "objects3d/armllt.s3o" }, { path: "objects3d/ghost.s3o" }],
    archivePath: "/root/games/game.sdd",
    errors: [],
  }),
  unitsyncUnitDataset: async () => ({
    units: [
      { name: "armllt", fullName: "Light Laser Tower", objectName: "armllt" },
      { name: "ghost", fullName: "Ghost", objectName: "ghost" },
    ],
    errors: [],
  }),
}));

let read: ScanDeps["read"];
vi.mock("@/lego/skeletonScanRead", () => ({
  skeletonScanDeps: (): ScanDeps => ({
    read: (unit) => read(unit),
    infer: async () => ({ proposals: [], legs: [], notes: [], error: null }),
  }),
}));

const { ScanSkeletons } = await import("./ScanSkeletons");

function project(def: Record<string, unknown> | null) {
  const base = newProject({
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-11-10T00:00:00.000Z",
  });
  return {
    ...base,
    pieces: [base.pieces[0] as LegoPiece],
    ...(def ? { gameUnitDef: def } : {}),
  };
}

const game = {
  name: "Game 1.0",
  primaryArchive: { name: "game.sdd" },
  info: { shortname: "G" },
} as unknown as GameItem;

function renderScan() {
  render(
    <MemoryRouter>
      <ScanSkeletons
        rootPath="/root"
        enginePath="/engine"
        games={[game]}
        picked={null}
        busy={false}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Scan units" }));
  fireEvent.click(screen.getByRole("button", { name: "Scan" }));
}

afterEach(() => {
  cleanup();
  files.clear();
});

describe("ScanSkeletons", () => {
  it("lists each unit, links one with no plan and writes the rest", async () => {
    // The tower is a building, and the ghost has no definition to say so.
    read = async (unit) => ({
      project: project(unit.unit === "armllt" ? {} : null),
      script: "",
      notes: [],
    });
    renderScan();

    await screen.findByText(/Scanned 2 units in .*: 1 full, 0 partial, 1 none/);
    const list = screen.getByRole("list", { name: "Scanned units" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("Ghost");
    expect(rows[0]?.textContent).toContain("None");
    const link = within(rows[0] as HTMLElement).getByRole("link", {
      name: "Open in builder",
    });
    expect(link.getAttribute("href")).toContain("unit=ghost");
    expect(rows[1]?.textContent).toContain("Full");

    const written = [...files.entries()].find(([path]) =>
      path.endsWith("G.json"),
    );
    expect(written).toBeDefined();
    const file = JSON.parse(written?.[1] ?? "");
    expect(Object.keys(file.units)).toEqual(["armllt"]);
    expect(file.units.armllt.evidence).toBe("observed");
  });

  it("stops at once when asked, keeping what it scanned", async () => {
    read = async (unit) =>
      unit.unit === "ghost"
        ? new Promise(() => {})
        : { project: project({}), script: "", notes: [] };
    renderScan();

    const stop = await screen.findByRole("button", { name: "Stop" });
    await screen.findByText("Scanned 1 of 2 units.");
    fireEvent.click(stop);
    await waitFor(() =>
      expect(
        screen.getByText(/Stopped after 1 of 2 units in .*: 1 full/),
      ).toBeTruthy(),
    );
  });
});
