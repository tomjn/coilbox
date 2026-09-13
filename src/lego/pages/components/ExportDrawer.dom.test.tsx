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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { ExportDrawer } from "./ExportDrawer";

const legoGameLanguage = vi.fn();
const legoExport = vi.fn();

vi.mock("../../bindings", () => ({
  legoExport: (args: unknown) => legoExport(args),
  legoExportGlb: vi.fn(),
  legoExportObj: vi.fn(),
  legoExportStale: vi.fn().mockResolvedValue({
    ours: [],
    kept: [],
    missing: [],
    dryRun: true,
  }),
  legoGameLanguage: (args: { dir: string }) => legoGameLanguage(args),
  legoOpenPath: vi.fn(),
  legoTexturePng: vi.fn(),
}));

/** What `legoExport` answers for a successful export, with `cobVars: null`
 *  and `cobVarsKept: false` matching a script that shares no values, unless
 *  overridden. */
function exportResult(over: Record<string, unknown> = {}) {
  return {
    model: "/game/objects3d/skyfort.s3o",
    texture: null,
    language: null,
    script: "/game/scripts/skyfort.lua",
    scriptKept: false,
    cobVars: null,
    cobVarsKept: false,
    pieceCollision: "/game/scripts/coilbox/skyfort_collision.lua",
    unitDef: "/game/units/skyfort.lua",
    unitDefKept: false,
    textureKept: false,
    textures: [],
    texturesKept: [],
    owned: [],
    ...over,
  };
}

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
      onStale={vi.fn()}
    />,
  );
}

beforeEach(() => {
  legoGameLanguage.mockReset();
  legoExport.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("where the unit's name is going", () => {
  it("says the definition for a game with no localisation file", async () => {
    legoGameLanguage.mockResolvedValue({ texts: {} });
    show();
    await waitFor(() =>
      expect(screen.getByText(/goes into the definition/)).toBeTruthy(),
    );
    expect(screen.queryByText(/coilbox\.json/)).toBeNull();
  });

  it("says the language file for a game that names its units there", async () => {
    legoGameLanguage.mockResolvedValue({
      texts: {
        en: { names: { armcom: "Armada Commander" }, descriptions: {} },
      },
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
      texts: {
        en: { names: { skyfort: "The Game's Own Skyfort" }, descriptions: {} },
      },
    });
    show();
    await waitFor(() =>
      expect(screen.getByText(/coilbox writes no name for it/)).toBeTruthy(),
    );
  });

  /**
   * A game that ships no English file names its units in whichever locale it
   * does ship, so the name follows that rather than landing in a folder the
   * game has no file in (issue #2672 made this possible to get wrong).
   */
  it("names the locale the game's other files fall back to", async () => {
    legoGameLanguage.mockResolvedValue({
      texts: { ru: { names: { armcom: "Командир" }, descriptions: {} } },
    });
    show();
    await waitFor(() =>
      expect(screen.getByText(/language\/ru\/coilbox\.json/)).toBeTruthy(),
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

/**
 * The polyfill note, for a script that keeps shared COB unit values as rules
 * params. A game's gadgets and widgets can only reach them by including
 * `lualibs/cob_vars.lua`, so the drawer says the path it went to and the line
 * that wires it in.
 */
describe("the shared values polyfill", () => {
  it("shows where it was written and the line that includes it", async () => {
    legoGameLanguage.mockResolvedValue({ texts: {} });
    legoExport.mockResolvedValue(
      exportResult({ cobVars: "/game/lualibs/cob_vars.lua" }),
    );
    show();
    await waitFor(() =>
      expect(screen.getByText(/goes into the definition/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(screen.getByText("/game/lualibs/cob_vars.lua")).toBeTruthy(),
    );
    expect(
      screen.getByText('VFS.Include("lualibs/cob_vars.lua")'),
    ).toBeTruthy();
  });

  it("says nothing about it for a script that shares no values", async () => {
    legoGameLanguage.mockResolvedValue({ texts: {} });
    legoExport.mockResolvedValue(exportResult());
    show();
    await waitFor(() =>
      expect(screen.getByText(/goes into the definition/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(screen.getByText("/game/scripts/skyfort.lua")).toBeTruthy(),
    );
    expect(screen.queryByText(/VFS\.Include/)).toBeNull();
  });
});
