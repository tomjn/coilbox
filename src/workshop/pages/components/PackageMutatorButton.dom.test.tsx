// @vitest-environment happy-dom
/**
 * The button that packages a workshop project as a `.sdz` (issue #1283).
 * What matters here is the gate and the version, not the compiler's own
 * output (`compile.test.ts` already covers that): preflight has to run and
 * come back clean before anything is written, a cancelled save dialog must
 * write nothing, and a successful package has to report the version it
 * wrote so the caller can record it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const project = {
  id: "p1",
  name: "Faster commanders",
  gameName: "Balanced Annihilation V15.9.8",
  edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const { save, workshopPreflight, workshopPackageMutator } = vi.hoisted(() => ({
  save: vi.fn(
    async (): Promise<string | null> => "/home/tom/faster-commanders-v1.sdz",
  ),
  workshopPreflight: vi.fn(async () => ({
    blockers: [] as string[],
    review: [] as string[],
    passes: [] as string[],
  })),
  workshopPackageMutator: vi.fn(async () => ({
    path: "/home/tom/faster-commanders-v1.sdz",
    files: ["modinfo.lua"],
    version: 1,
  })),
}));

/** Reassigned per test, and read by the mock below at call time. */
let mockCompiled: {
  compiled: { files: { path: string; contents: string }[] } | null;
  loading: boolean;
  error: string | null;
} = { compiled: { files: [] }, loading: false, error: null };

vi.mock("../../compile", () => ({ useCompiledProject: () => mockCompiled }));
vi.mock("../../preflight", () => ({ workshopPreflight }));
vi.mock("../../package", () => ({
  workshopPackageMutator,
  packagedMutatorFileName: (p: { name: string }, version: number) =>
    `${p.name.toLowerCase().replace(/\s+/g, "-")}-v${version}.sdz`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));

const { PackageMutatorButton } = await import("./PackageMutatorButton");

function compiled(files: { path: string; contents: string }[]) {
  return { compiled: { files }, loading: false, error: null };
}

function draw(onPackaged = vi.fn()) {
  render(
    // biome-ignore lint/suspicious/noExplicitAny: a trimmed test fixture, not the real ModProject
    <PackageMutatorButton project={project as any} onPackaged={onPackaged} />,
  );
  return onPackaged;
}

afterEach(() => {
  cleanup();
  save.mockClear();
  save.mockResolvedValue("/home/tom/faster-commanders-v1.sdz");
  workshopPreflight.mockClear();
  workshopPreflight.mockResolvedValue({ blockers: [], review: [], passes: [] });
  workshopPackageMutator.mockClear();
  workshopPackageMutator.mockResolvedValue({
    path: "/home/tom/faster-commanders-v1.sdz",
    files: ["modinfo.lua"],
    version: 1,
  });
  mockCompiled = compiled([]);
});

describe("PackageMutatorButton", () => {
  it("says there is nothing to package when the project has no edits", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^package$/i }));
    expect(screen.getByText(/nothing to package yet/i)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /nothing to package yet/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(workshopPreflight).not.toHaveBeenCalled();
  });

  it("offers version 1 for a project never packaged before", () => {
    mockCompiled = compiled([{ path: "modinfo.lua", contents: "" }]);
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^package$/i }));
    expect(screen.getByText(/version 1/i)).toBeTruthy();
  });

  it("checks preflight, writes the archive and reports the version it wrote", async () => {
    mockCompiled = compiled([{ path: "modinfo.lua", contents: "return {}" }]);
    const onPackaged = draw();
    fireEvent.click(screen.getByRole("button", { name: /^package$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save as \.sdz/i }));

    await vi.waitFor(() =>
      expect(workshopPackageMutator).toHaveBeenCalledTimes(1),
    );
    expect(workshopPreflight).toHaveBeenCalledWith({ project });
    expect(workshopPackageMutator).toHaveBeenCalledWith({
      project,
      version: 1,
      dest: "/home/tom/faster-commanders-v1.sdz",
    });
    expect(onPackaged).toHaveBeenCalledWith(1);
    await vi.waitFor(() =>
      expect(screen.getByText(/faster-commanders-v1\.sdz/)).toBeTruthy(),
    );
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    mockCompiled = compiled([{ path: "modinfo.lua", contents: "return {}" }]);
    save.mockResolvedValue(null);
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^package$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save as \.sdz/i }));

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(workshopPackageMutator).not.toHaveBeenCalled();
  });

  it("refuses to package when preflight finds a blocker, before any dialog opens", async () => {
    mockCompiled = compiled([{ path: "modinfo.lua", contents: "return {}" }]);
    workshopPreflight.mockResolvedValue({
      blockers: ["supercom is defined by 2 copies"],
      review: [],
      passes: [],
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^package$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save as \.sdz/i }));

    await vi.waitFor(() => expect(screen.getByText(/1 blocker/i)).toBeTruthy());
    expect(screen.getByText(/supercom is defined by 2 copies/)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    expect(workshopPackageMutator).not.toHaveBeenCalled();
  });
});
