// @vitest-environment happy-dom

/**
 * The builder's bottom strip: which tabs an imported unit gets.
 *
 * Parts and Compounds have nothing for a unit imported whole (issue #712), so
 * they are hidden for it, but the strip itself used to disappear too, which
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
import type { LegoDocumentSession } from "../useLegoDocument";

const doc: { current: LegoDocumentSession } = { current: null as never };

// The sidebar-hiding registry is the app shell's, which nothing here renders.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useHideSidebar: () => {},
}));

vi.mock("../useLegoDocument", () => ({
  useLegoDocument: () => doc.current,
}));

vi.mock("../projects", () => ({
  useLegoCompounds: () => ({ compounds: [] }),
  useLegoProjects: () => ({ projects: [] }),
  deleteCompound: vi.fn(),
  saveCompound: vi.fn(),
}));

vi.mock("../pack", async () => {
  const actual = await vi.importActual<typeof import("../pack")>("../pack");
  return {
    ...actual,
    loadPack: async () => ({
      manifest: { categories: [] } as never,
      library: {
        packs: [],
        atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
        dir: "",
        problems: [],
      },
      parts: [],
      byId: new Map(),
      vertices: new Float32Array(0),
      indices: new Uint16Array(0),
    }),
    projectPackProblems: () => [],
  };
});

vi.mock("../useRawGeometry", () => ({
  useRawGeometry: () => ({
    raw: null,
    loading: false,
    error: null,
    missingTextures: [],
  }),
}));

vi.mock("./components/ModelViewport", () => ({
  ModelViewport: () => null,
}));

// Reads the app's own settings store for its target engine, which nothing
// here provides, and is not what this test is about.
vi.mock("./components/TestDrawer", () => ({
  TestDrawer: () => null,
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
    undo: vi.fn(),
    redo: vi.fn(),
    save: vi.fn(),
    lift: () => null,
    selectMany: vi.fn(),
    insert: () => [],
    duplicate: () => [],
    onCapture: vi.fn(),
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
});

afterEach(() => {
  cleanup();
});

describe("a unit built out of parts", () => {
  it("offers Parts, Compounds and Script", async () => {
    show(unit());
    await screen.findByRole("button", { name: "Script" });
    expect(screen.getByRole("button", { name: "Parts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compounds" })).toBeTruthy();
  });
});

describe("a unit imported whole", () => {
  it("offers only Script, not Parts or Compounds", async () => {
    show(unit({ imported: { source: "/tmp/unit.s3o" } }));
    await screen.findByRole("button", { name: "Script" });
    expect(screen.queryByRole("button", { name: "Parts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compounds" })).toBeNull();
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
