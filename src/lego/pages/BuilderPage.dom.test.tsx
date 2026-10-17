// @vitest-environment happy-dom

/**
 * The builder's bottom strip: which tabs an imported unit gets.
 *
 * The inventory has nothing for a unit imported whole (issue #712), so it is
 * hidden for it, but the strip itself used to disappear too, which
 * took Script with it. An imported unit is usually the one carrying its
 * game's own script, so Script is the one tab that has to survive.
 *
 * Everything else `BuilderPage` touches (the document store, the parts
 * library, the raw geometry loader, the 3D viewport) is mocked: this test is
 * about which tabs the strip offers, not about any of that machinery.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LegoProject, newProject } from "../model";
import type { RawGeometry } from "../rawGeometry";
import type { LegoDocumentSession } from "../useLegoDocument";

const doc: { current: LegoDocumentSession } = { current: null as never };

// The sidebar-hiding registry is the app shell's, which nothing here renders.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useHideSidebar: () => {},
  // The recent and favourite lists are app settings, which need the frame's
  // store. This test is not about them.
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));

vi.mock("../useLegoDocument", () => ({
  useLegoDocument: () => doc.current,
}));

vi.mock("../projects", () => ({
  useModules: () => [],
  useLegoCompounds: () => ({ compounds: [], loading: false }),
  useLegoProjects: () => ({ projects: [] }),
  deleteCompound: vi.fn(),
  saveCompound: vi.fn(),
}));

vi.mock("../pack", async () => {
  const actual = await vi.importActual<typeof import("../pack")>("../pack");
  return {
    ...actual,
    loadPack: () => packLoad,
    projectPackProblems: () => [],
  };
});

/** What the parts library read answers with, swapped per test: the wait, the
 *  failure and the success all take different paths through the guard. */
let packLoad: Promise<unknown>;
const loadedPack = (parts: unknown[] = []) =>
  Promise.resolve({
    manifest: { categories: [] } as never,
    library: {
      packs: [],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
    parts,
    byId: new Map(),
    vertices: new Float32Array(0),
    indices: new Uint16Array(0),
  });

/** What the unit's geometry file holds, swapped per test. */
let loadedRaw: RawGeometry | null = null;

vi.mock("../useRawGeometry", () => ({
  useRawGeometry: () => ({
    raw: loadedRaw,
    loading: false,
    error: null,
    missingTextures: [],
  }),
}));

// Draws its `chrome`, which is the toolbar over the view.
vi.mock("./components/ModelViewport", () => ({
  ModelViewport: ({ chrome }: { chrome?: React.ReactNode }) => chrome,
}));

// Reads the app's own settings store for its target engine, which nothing
// here provides, and is not what this test is about. The script tab reads the
// same store, for the button that takes a game's compiled script again.
vi.mock("./components/TestDrawer", () => ({
  TestDrawer: () => null,
}));
// Reads a display setting from the app frame, which nothing here provides.
vi.mock("./components/PartPicker", () => ({ PartPicker: () => null }));
// Reads the unit's file in its game through unitsync, for a factory's yardmap.
vi.mock("./components/useBuiltUnitDef", () => ({
  useBuiltUnitDef: () => ({ game: undefined, key: null, def: undefined }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({ target: undefined }),
}));
// The export drawer reads the workshop's projects for library weapons, out of
// the app's settings store, which nothing here provides.
vi.mock("@/workshop/project", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workshop/project")>()),
  useModProjects: () => ({ projects: [] }),
}));

import BuilderPage from "./BuilderPage";

function unit(over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "base",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-09-22T00:00:00Z",
  });
  return { ...base, ...over };
}

function session(project: LegoProject): LegoDocumentSession {
  return {
    loading: false,
    project,
    dirty: false,
    saving: false,
    canUndo: false,
    canRedo: false,
    selectedIds: [],
    selectedId: null,
    select: vi.fn(),
    toggleSelect: vi.fn(),
    edit: vi.fn(),
    fill: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    save: vi.fn(),
    lift: () => null,
    selectMany: vi.fn(),
    insert: () => ({ rootPieceIds: [], held: [] }),
    duplicate: () => [],
    onCapture: vi.fn(),
    capture: vi.fn(() => null),
  };
}

function show(project: LegoProject) {
  doc.current = session(project);
  return render(
    <MemoryRouter initialEntries={["/lego/p"]}>
      <Routes>
        <Route path="/lego/:id" element={<BuilderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  packLoad = loadedPack();
  loadedRaw = null;
});

afterEach(() => {
  cleanup();
});

describe("a unit built out of parts", () => {
  it("offers the Inventory and Script", async () => {
    show(unit());
    await screen.findByRole("button", { name: "Script" });
    expect(screen.getByRole("button", { name: "Inventory" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compounds" })).toBeNull();
  });
});

describe("a lifted piece saved before its box was recorded (#4354)", () => {
  it("is given the box of its mesh when the geometry has loaded, as a fill and not an edit", async () => {
    loadedRaw = {
      byId: new Map([
        [
          "m0",
          {
            id: "m0",
            vFirst: 0,
            vCount: 0,
            iFirst: 0,
            iCount: 0,
            bbox: { min: [-1, 0, -1], max: [1, 4, 1] },
          },
        ],
      ]),
      vertices: new Float32Array(),
      indices: new Uint32Array(),
    };
    const old = unit();
    const withMesh: LegoProject = {
      ...old,
      pieces: [
        ...old.pieces,
        {
          id: "lifted",
          name: "lifted",
          parentId: "base",
          partId: null,
          meshId: "m0",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    };
    show(withMesh);
    await screen.findByRole("button", { name: "Script" });

    const fill = vi.mocked(doc.current.fill);
    expect(fill).toHaveBeenCalled();
    const filled = fill.mock.calls[0][0](withMesh);
    expect(filled.pieces.find((p) => p.id === "lifted")?.meshBox).toEqual({
      min: [-1, 0, -1],
      max: [1, 4, 1],
    });
    expect(doc.current.edit).not.toHaveBeenCalled();
  });
});

describe("the build arm button", () => {
  const part = (id: string, shape: string, long: number) => ({
    id,
    name: id,
    shape,
    shapeId: id,
    category: "grey",
    colourway: "grey",
    material: "",
    tags: [],
    packId: "lego",
    bbox: { min: [-0.25, -long / 2, -0.25], max: [0.25, long / 2, 0.25] },
  });

  it("adds the arm and its presets in one edit", async () => {
    packLoad = loadedPack([part("blk", "block", 0.5), part("bm", "beam", 2)]);
    show(unit());
    fireEvent.click(
      await screen.findByRole("button", { name: "Add a build arm" }),
    );

    const edit = doc.current.edit as ReturnType<typeof vi.fn>;
    expect(edit).toHaveBeenCalledTimes(1);
    const next = edit.mock.calls[0][0](unit());
    expect(next.pieces.map((p: { role?: string }) => p.role).sort()).toEqual([
      "buildarm.arm",
      "buildarm.base",
      "buildarm.nano",
      "buildarm.nozzle",
      undefined,
    ]);
    expect(
      next.animations.map((a: { presetId: string }) => a.presetId),
    ).toEqual(["build.aim", "build.nano"]);
  });

  it("is not offered for a unit imported whole", async () => {
    show(unit({ imported: { source: "/tmp/unit.s3o" } }));
    await screen.findByRole("button", { name: "Script" });
    expect(
      screen.queryByRole("button", { name: "Add a build arm" }),
    ).toBeNull();
  });

  // The weapon module, beside it (issue #3274).
  it("adds a turret, barrel and flare with the aim and recoil presets", async () => {
    packLoad = loadedPack([part("blk", "block", 0.5), part("bm", "beam", 2)]);
    show(unit());
    fireEvent.click(
      await screen.findByRole("button", { name: "Add a weapon" }),
    );

    const edit = doc.current.edit as ReturnType<typeof vi.fn>;
    expect(edit).toHaveBeenCalledTimes(1);
    const next = edit.mock.calls[0][0](unit());
    expect(next.pieces.map((p: { role?: string }) => p.role).sort()).toEqual([
      "barrel",
      "flare",
      "turret",
      undefined,
    ]);
    expect(
      next.animations.map((a: { presetId: string }) => a.presetId),
    ).toEqual(["turret.track", "recoil"]);
  });
});

describe("a unit imported whole", () => {
  it("offers only Script, not the Inventory", async () => {
    show(unit({ imported: { source: "/tmp/unit.s3o" } }));
    await screen.findByRole("button", { name: "Script" });
    expect(screen.queryByRole("button", { name: "Inventory" })).toBeNull();
  });

  it("names the script in the collapse button's label", async () => {
    show(unit({ imported: { source: "/tmp/unit.s3o" } }));
    const collapse = await screen.findByRole("button", {
      name: "Hide the script",
    });
    fireEvent.click(collapse);
    expect(
      screen.getByRole("button", { name: "Show the script" }),
    ).toBeTruthy();
  });
});

describe("while the unit is still opening", () => {
  it("says it is opening rather than that it failed", async () => {
    // Never settles, which is the window the failure used to show in: the
    // document has loaded and the parts library has not.
    packLoad = new Promise(() => {});
    show(unit());

    expect(await screen.findByText("Opening the unit.")).toBeTruthy();
    expect(screen.queryByText(/could not be opened/)).toBeNull();
  });

  it("says it failed once the parts library will not read", async () => {
    packLoad = Promise.reject(new Error("no library"));
    show(unit());

    expect(
      await screen.findByText("This unit could not be opened."),
    ).toBeTruthy();
  });
});

describe("the build picture action", () => {
  it("is in the toolbar and opens the build picture drawer", async () => {
    show(unit());
    fireEvent.click(
      await screen.findByRole("button", { name: "Build picture" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Build picture" }),
    ).toBeTruthy();
  });

  it("marks the toolbar button when the unit has changed since the picture", async () => {
    show(
      unit({
        picture: {
          size: 320,
          background: null,
          view: "right",
          takenAt: "2026-10-16T00:00:00Z",
          fingerprint: "an older unit",
        },
      }),
    );
    await screen.findByRole("button", { name: "Build picture" });
    expect(
      document.querySelector("button[aria-label='Build picture'] span"),
    ).toBeTruthy();
  });
});
