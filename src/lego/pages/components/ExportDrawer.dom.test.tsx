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
import { EMPTY_EDITS, type ModProject } from "@/workshop/project";
import { type LegoProject, newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { ExportDrawer } from "./ExportDrawer";

const legoGameLanguage = vi.fn();
const legoExport = vi.fn();
const legoExportPicture = vi.fn();
const legoAtlasPng = vi.fn();
const exportGlb = vi.fn();

vi.mock("../../exportGlb", () => ({
  exportGlb: (...args: unknown[]) => exportGlb(...args),
}));

// The export drawer reads the workshop's projects for library weapons, out of
// the app's settings store, which nothing here provides.
const workshopProjects = vi.fn((): ModProject[] => []);
const workshopCompile = vi.fn();
vi.mock("@/workshop/project", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workshop/project")>()),
  useModProjects: () => ({ projects: workshopProjects() }),
}));
vi.mock("@/workshop/compile", () => ({
  workshopCompile: (args: unknown) => workshopCompile(args),
}));
vi.mock("../../bindings", () => ({
  legoAtlasPng: (args: unknown) => legoAtlasPng(args),
  legoExport: (args: unknown) => legoExport(args),
  legoExportGlb: vi.fn(),
  legoExportObj: vi.fn(),
  legoExportPicture: (args: unknown) => legoExportPicture(args),
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
    weapons: [],
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

function show(shown = project, onRemember = vi.fn()) {
  return render(
    <ExportDrawer
      open
      onOpenChange={vi.fn()}
      project={shown}
      pack={pack}
      raw={null}
      onRemember={onRemember}
      onStale={vi.fn()}
    />,
  );
}

beforeEach(() => {
  legoGameLanguage.mockReset();
  legoExport.mockReset();
  legoExportPicture.mockReset();
  legoAtlasPng.mockReset();
  exportGlb.mockReset();
  workshopCompile.mockReset();
  workshopProjects.mockReturnValue([]);
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
/**
 * A turret's weapon reaches the definition, and a library weapon is read from
 * the workshop and written as its own file (issue #3274).
 */
describe("weapons", () => {
  const armed: LegoProject = {
    ...project,
    pieces: [
      project.pieces[0],
      {
        ...project.pieces[0],
        id: "gun",
        name: "gun",
        parentId: project.rootPieceId,
        role: "turret",
        weapon: {
          fires: { from: "library", projectId: "w1", key: "laser_copy" },
        },
      },
      {
        ...project.pieces[0],
        id: "gun2",
        name: "gun2",
        parentId: project.rootPieceId,
        role: "turret",
        weapon: { fires: { from: "game", name: "armpw_emg" }, arc: 90 },
      },
    ],
  };
  const library: ModProject = {
    id: "w1",
    name: "Lasers",
    gameName: "Splinter Faction",
    edits: {
      ...EMPTY_EDITS,
      weapons: {
        laser_copy: { key: "laser_copy", source: "emg", def: { range: 1 } },
      },
    },
    createdAt: "",
    updatedAt: "",
  };

  it("writes the slots into the definition and the library weapon's file", async () => {
    workshopProjects.mockReturnValue([library]);
    workshopCompile.mockResolvedValue({
      chunks: [],
      notes: [],
      tweakdefs: null,
      files: [
        {
          path: "weapons/coilbox_skyfort_laser_copy.lua",
          contents: "return {}",
        },
      ],
    });
    legoGameLanguage.mockResolvedValue({ texts: {} });
    legoExport.mockResolvedValue(
      exportResult({
        weapons: ["/game/weapons/coilbox_skyfort_laser_copy.lua"],
      }),
    );
    show(armed);
    await waitFor(() =>
      expect(screen.getByText(/goes into the definition/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(
        screen.getByText("/game/weapons/coilbox_skyfort_laser_copy.lua"),
      ).toBeTruthy(),
    );
    const sent = legoExport.mock.calls[0][0];
    expect(sent.weapons).toEqual([
      { name: "coilbox_skyfort_laser_copy.lua", contents: "return {}" },
    ]);
    expect(sent.unitDef).toContain(
      'weapons = { { def = "laser_copy", name = "skyfort_laser_copy" }, { def = "armpw_emg", name = "armpw_emg", maxangledif = 90, maindir = "0 0 1" } },',
    );
  });

  it("says which weapon it left out and why", async () => {
    workshopProjects.mockReturnValue([]);
    legoGameLanguage.mockResolvedValue({ texts: {} });
    legoExport.mockResolvedValue(exportResult());
    show(armed);
    await waitFor(() =>
      expect(screen.getByText(/goes into the definition/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Weapon left out: laser_copy: its workshop project is gone.",
        ),
      ).toBeTruthy(),
    );
    expect(workshopCompile).not.toHaveBeenCalled();
    expect(legoExport.mock.calls[0][0].weapons).toEqual([]);
  });
});

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

/**
 * The build picture is write once (issue #3347). The drawer sends the digest the
 * receipt holds for the picture's path, so the file on disk is replaced only if
 * the builder wrote it, and says so when it was left alone.
 */
describe("the build picture", () => {
  const withPicture = {
    ...project,
    picture: {
      size: 320,
      background: null,
      view: "right" as const,
      takenAt: "2026-10-16T00:00:00Z",
      fingerprint: "f",
    },
    exported: {
      dir: "/games/some.sdd",
      at: "",
      unitName: "skyfort",
      def: {},
      files: [
        {
          path: "/games/some.sdd/unitpics/skyfort.png",
          sha256: "last-written",
        },
      ],
    },
  };

  async function exportIt(shown: typeof withPicture, onRemember = vi.fn()) {
    legoGameLanguage.mockResolvedValue({ texts: {} });
    legoExport.mockResolvedValue(exportResult());
    show(shown, onRemember);
    await waitFor(() =>
      expect(screen.getByText(/goes into the definition/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
  }

  it("sends the digest the builder last wrote and reports the new file", async () => {
    legoExportPicture.mockResolvedValue({
      path: "/games/some.sdd/unitpics/skyfort.png",
      kept: false,
      owned: [{ path: "/games/some.sdd/unitpics/skyfort.png", sha256: "new" }],
    });
    const onRemember = vi.fn();
    await exportIt(withPicture, onRemember);
    await waitFor(() =>
      expect(
        screen.getByText("/games/some.sdd/unitpics/skyfort.png"),
      ).toBeTruthy(),
    );
    expect(legoExportPicture).toHaveBeenCalledWith({
      dir: "/games/some.sdd",
      unitName: "skyfort",
      id: "p",
      written: "last-written",
    });
    const remembered = onRemember.mock.calls[0][0];
    expect(remembered.exported.files).toEqual([
      { path: "/games/some.sdd/unitpics/skyfort.png", sha256: "new" },
    ]);
  });

  it("says so when a picture the builder did not write was left alone", async () => {
    legoExportPicture.mockResolvedValue({
      path: "/games/some.sdd/unitpics/skyfort.png",
      kept: true,
      owned: [],
    });
    const onRemember = vi.fn();
    await exportIt(withPicture, onRemember);
    await waitFor(() =>
      expect(
        screen.getByText(/did not write, and has been left alone/),
      ).toBeTruthy(),
    );
    // Kept, so the receipt still holds the digest of the last one coilbox wrote.
    expect(onRemember.mock.calls[0][0].exported.files).toEqual([
      { path: "/games/some.sdd/unitpics/skyfort.png", sha256: "last-written" },
    ]);
  });

  it("writes no picture when none has been taken", async () => {
    await exportIt(project as typeof withPicture);
    await waitFor(() =>
      expect(screen.getByText("/game/scripts/skyfort.lua")).toBeTruthy(),
    );
    expect(legoExportPicture).not.toHaveBeenCalled();
  });

  it("still reports the export when the picture could not be written", async () => {
    legoExportPicture.mockRejectedValue(new Error("disk full"));
    await exportIt(withPicture);
    await waitFor(() =>
      expect(screen.getByText(/build picture is not: disk full/)).toBeTruthy(),
    );
    expect(screen.getByText("/game/scripts/skyfort.lua")).toBeTruthy();
  });
});

/**
 * The bundled atlas has no alpha channel, which the `.glb` bake reads as full
 * team colour, so a unit built from parts was written entirely in team colour
 * (#4173). The atlas has to come from the same Rust rule the `.s3o` export
 * writes it by, not straight from its file.
 */
describe("the .glb of a unit built from parts", () => {
  it("bakes the atlas as the engine rule reads it, not as the file stands", async () => {
    legoGameLanguage.mockResolvedValue({ texts: {} });
    legoExport.mockResolvedValue(exportResult());
    legoAtlasPng.mockResolvedValue({ dataUrl: "data:image/png;base64,ENGINE" });
    exportGlb.mockResolvedValue(null);
    show({ ...project, exportGlb: true });
    await waitFor(() =>
      expect(screen.getByText(/goes into the definition/)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(exportGlb).toHaveBeenCalled());
    expect(legoAtlasPng).toHaveBeenCalledWith({
      atlas: {
        name: "atlas.png",
        pack: undefined,
        writeAs: "coilbox_atlas.png",
      },
    });
    expect(exportGlb.mock.calls[0][3]).toBe("data:image/png;base64,ENGINE");
  });
});
