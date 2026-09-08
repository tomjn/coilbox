// @vitest-environment happy-dom

/**
 * What the export drawer says about where this unit's name is going (issue
 * #2683).
 *
 * Worth a test of its own because the wrong answer is invisible: a unit named
 * in its definition looks perfectly correct everywhere in coilbox and is wrong
 * only once the game draws it. So the drawer says which of the two homes it is
 * about to use before anybody presses the button, and this covers all three
 * things it can say.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedPack } from "../../pack";
import { newProject } from "../../model";
import { ExportDrawer } from "./ExportDrawer";

const legoGameLanguage = vi.fn();

vi.mock("../../bindings", () => ({
  legoExport: vi.fn(),
  legoExportGlb: vi.fn(),
  legoExportObj: vi.fn(),
  legoGameLanguage: (args: { dir: string }) => legoGameLanguage(args),
  legoOpenPath: vi.fn(),
  legoTexturePng: vi.fn(),
}));

const project = {
  ...newProject({
    id: "p",
    rootPieceId: "base",
    name: "Sky Fortress",
    unitName: "skyfort",
    packId: "lego",
    packVersion: "1",
    now: "2026-09-08T00:00:00Z",
  }),
  exportDir: "/games/some.sdd",
};

const pack = {
  library: {
    atlases: [{ tex1: "atlas.png", folder: undefined }],
  },
} as unknown as LoadedPack;

function show() {
  return render(
    <ExportDrawer
      open
      onOpenChange={vi.fn()}
      project={project}
      pack={pack}
      raw={null}
      onRemember={vi.fn()}
    />,
  );
}

beforeEach(() => {
  legoGameLanguage.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("where the unit's name is going", () => {
  it("says the definition for a game with no localisation file", async () => {
    legoGameLanguage.mockResolvedValue({
      present: false,
      names: {},
      descriptions: {},
    });
    show();
    await waitFor(() =>
      expect(screen.getByText(/goes into the definition/)).toBeTruthy(),
    );
    expect(screen.queryByText(/coilbox\.json/)).toBeNull();
  });

  it("says the language file for a game that names its units there", async () => {
    legoGameLanguage.mockResolvedValue({
      present: true,
      names: { armcom: "Armada Commander" },
      descriptions: {},
    });
    show();
    await waitFor(() =>
      expect(screen.getByText(/language\/en\/coilbox\.json/)).toBeTruthy(),
    );
    // The promise this whole approach rests on, said out loud on the screen.
    expect(
      screen.getByText(/own file is never opened for writing/),
    ).toBeTruthy();
  });

  /**
   * A name the game itself declares is the game's. Export keeps that unit's own
   * definition rather than overwriting it, so writing our name over the game's
   * would rename a unit that was never ours.
   */
  it("writes no name where the game already names that unit", async () => {
    legoGameLanguage.mockResolvedValue({
      present: true,
      names: { skyfort: "The Game's Own Skyfort" },
      descriptions: {},
    });
    show();
    await waitFor(() =>
      expect(screen.getByText(/coilbox writes no name for it/)).toBeTruthy(),
    );
  });

  /**
   * Reported rather than guessed at silently. Falling back to the definition is
   * what every export did before this, so nothing gets worse, but the one game
   * it is wrong for is the game this exists for.
   */
  it("says so when the game's own file will not read", async () => {
    legoGameLanguage.mockRejectedValue(new Error("will not parse as JSON"));
    show();
    await waitFor(() =>
      expect(screen.getByText(/will not parse as JSON/)).toBeTruthy(),
    );
  });
});
