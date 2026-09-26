// @vitest-environment happy-dom
/**
 * Applying a project from the presets panel (issue #3122): a game with tweak
 * slots must settle typed values against the game before packing, the same
 * check the workshop's own Package drawer runs before a BAR pack
 * (`PackageMutatorButton.dom.test.tsx`). What matters here is that the settle
 * runs before `workshopPackBarSlots`, that its `written` map reaches the pack
 * call, and that a failed or skipped settle still applies the project as
 * typed rather than blocking it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const project = {
  id: "p1",
  name: "Faster commanders",
  gameName: "Beyond All Reason",
  edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const WRITTEN = {
  units: { armcom: { maxdamage: { typed: 0.5, written: 5.5555553 } } },
};

const TWEAK_SCHEMA = [{ key: "tweakdefs", name: "tweakdefs" }];

const { settleTypedValuesTweaks, workshopPackBarSlots, notify } = vi.hoisted(
  () => ({
    settleTypedValuesTweaks: vi.fn(
      async (_args: unknown): Promise<unknown> => ({
        ok: true,
        settled: {
          written: WRITTEN,
          fields: [
            {
              field: { kind: "unit", unit: "armcom", path: "maxdamage" },
              typed: 0.5,
              loadsAsTyped: 0.045,
              outcome: "written",
              written: 5.5555553,
            },
          ],
          loads: 3,
          elapsedMs: 1349,
        },
      }),
    ),
    workshopPackBarSlots: vi.fn(async () => ({
      tweakdefs: ["!bset tweakdefs abc123"],
      tweakunits: [] as string[],
      oversized: [] as string[],
      unplaced: [] as string[],
    })),
    notify: vi.fn(async () => {}),
  }),
);

vi.mock("@/workshop/project", () => ({
  useModProjects: () => ({ projects: [project] }),
}));
vi.mock("@/notify/notify", () => ({ notify }));
vi.mock("@/workshop/barPack", async () => {
  const actual =
    await vi.importActual<typeof import("@/workshop/barPack")>(
      "@/workshop/barPack",
    );
  return { ...actual, workshopPackBarSlots };
});
vi.mock("@/workshop/loadsAs", async () => {
  const actual =
    await vi.importActual<typeof import("@/workshop/loadsAs")>(
      "@/workshop/loadsAs",
    );
  return { ...actual, settleTypedValuesTweaks };
});

const { PresetTweaksView } = await import("./PresetTweaksView");

afterEach(() => {
  cleanup();
  settleTypedValuesTweaks.mockClear();
  workshopPackBarSlots.mockClear();
  notify.mockClear();
});

function draw(over: Partial<Parameters<typeof PresetTweaksView>[0]> = {}) {
  const onApply = vi.fn();
  render(
    <PresetTweaksView
      gameName="Beyond All Reason"
      modOptionsSchema={TWEAK_SCHEMA}
      onApply={onApply}
      enginePath="/engines/105"
      dataDir="/data"
      archive="byar.sdd"
      {...over}
    />,
  );
  return { onApply };
}

describe("applying a project onto tweak slots", () => {
  it("settles typed values against the game before packing, and reports what it did", async () => {
    const { onApply } = draw();
    fireEvent.click(screen.getByText(project.name));

    await vi.waitFor(() => expect(onApply).toHaveBeenCalled());

    expect(settleTypedValuesTweaks).toHaveBeenCalledWith({
      enginePath: "/engines/105",
      dataDir: "/data",
      archive: "byar.sdd",
      project,
      route: "numbered",
    });
    expect(workshopPackBarSlots).toHaveBeenCalledWith({
      project,
      written: WRITTEN,
    });
    expect(onApply).toHaveBeenCalledWith({ tweakdefs: "abc123" }, project);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: `Applied "${project.name}"`,
        level: "success",
        body: expect.stringMatching(/1 typed value is written/),
      }),
    );
  });

  it("packs as typed and says why when the engine or game is not resolved yet", async () => {
    const { onApply } = draw({
      enginePath: undefined,
      dataDir: undefined,
      archive: undefined,
    });
    fireEvent.click(screen.getByText(project.name));

    await vi.waitFor(() => expect(onApply).toHaveBeenCalled());

    expect(settleTypedValuesTweaks).not.toHaveBeenCalled();
    expect(workshopPackBarSlots).toHaveBeenCalledWith({
      project,
      written: undefined,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        body: expect.stringContaining("is not installed here"),
      }),
    );
  });

  it("packs as typed and says why when the settle itself fails", async () => {
    settleTypedValuesTweaks.mockResolvedValueOnce({
      ok: false,
      message: "Coilbox could not load the game to check typed values",
    });
    const { onApply } = draw();
    fireEvent.click(screen.getByText(project.name));

    await vi.waitFor(() => expect(onApply).toHaveBeenCalled());

    expect(workshopPackBarSlots).toHaveBeenCalledWith({
      project,
      written: undefined,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        body: expect.stringContaining(
          "could not load the game to check typed values",
        ),
      }),
    );
  });

  it("blocks a project that does not fit the game's slots without applying or notifying", async () => {
    workshopPackBarSlots.mockResolvedValueOnce({
      tweakdefs: ["!bset tweakdefs abc123", "!bset tweakdefs def456"],
      tweakunits: [],
      oversized: [],
      unplaced: [],
    });
    const { onApply } = draw();
    fireEvent.click(screen.getByText(project.name));

    await vi.waitFor(() =>
      expect(screen.getByText(/does not pack into the slots/)).toBeTruthy(),
    );
    expect(onApply).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
