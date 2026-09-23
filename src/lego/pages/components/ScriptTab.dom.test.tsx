// @vitest-environment happy-dom

/**
 * The Script tab: reading the generated script, taking it over, giving it
 * back, and what it says about the last run.
 *
 * Handing it back is the one worth covering closely. It discards text
 * somebody wrote, and the case it exists for is a unit whose owned script is
 * empty: that unit animates nothing, cannot be reached by a preset, and
 * before this could only be rescued by editing files on disk.
 *
 * Committing is the other one: there is no dialog to close any more, so blur
 * and leaving the tab are the only two ways an edit reaches the document, and
 * both are pinned here rather than assumed from ScriptDrawer's old behaviour.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../../model";
import { newProject } from "../../model";
import type { ScriptTimeline } from "../../scriptPlayback";
import { ScriptTab } from "./ScriptTab";

const decompileBytes = vi.fn();
vi.mock("@/animation/bindings", () => ({
  animCobDecompileBytes: (args: unknown) => decompileBytes(args),
}));

// The engine the reload would mount the archive with. Real here would mean a
// settings store and a unitsync call, neither of which this file is about.
const target = { enginePath: "/engine", dataDir: "/data" };
const preferredTarget = vi.fn<() => { target: typeof target | undefined }>(
  () => ({ target }),
);
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => preferredTarget(),
}));

const adopt = vi.fn();
vi.mock("../../adoptGameScript", () => ({
  adoptGameScript: (...args: unknown[]) => adopt(...args),
}));

function unit(over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "base",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
  return { ...base, ...over };
}

const onScriptChange = vi.fn();
const onScriptRelease = vi.fn();
const onCompiledReload = vi.fn();

function show(project: LegoProject, lastRun: ScriptTimeline | null = null) {
  return render(
    <ScriptTab
      project={project}
      onScriptChange={onScriptChange}
      onScriptRelease={onScriptRelease}
      onCompiledReload={onCompiledReload}
      lastRun={lastRun}
    />,
  );
}

/** How many of a source editor's lines are shown at reduced opacity, which is
 *  what the dim overlay's own per-line background marks. */
function dimmedLineCount(container: HTMLElement): number {
  return Array.from(container.querySelectorAll("div")).filter((div) =>
    div.className.includes("bg-background/60"),
  ).length;
}

beforeEach(() => {
  onScriptChange.mockClear();
  onScriptRelease.mockClear();
  decompileBytes.mockReset();
  decompileBytes.mockResolvedValue({ source: "", warnings: [] });
  onCompiledReload.mockClear();
  adopt.mockReset();
  preferredTarget.mockReturnValue({ target });
});

afterEach(() => {
  cleanup();
});

/**
 * A unit opened out of a game carries two spellings of every piece name: the
 * one its model file uses, kept on `originalName`, and the lower case one
 * coilbox gives its pieces so a generated script's locals are valid Lua
 * identifiers. Such a unit usually arrives carrying its game's own script,
 * which names the first.
 */
describe("a unit whose pieces have two spellings", () => {
  it("does not warn when a script names a piece as its model file spells it", () => {
    const [root] = unit().pieces;
    show(
      unit({
        script: 'local trunk = piece("Trunk")\n',
        pieces: [{ ...root, name: "trunk", originalName: "Trunk" }],
        rootPieceId: root.id,
      }),
    );
    expect(screen.queryByRole("button", { name: /check/ })).toBeNull();
  });

  it("still warns about a piece that is there under neither spelling", () => {
    const [root] = unit().pieces;
    show(
      unit({
        script: 'local ghost = piece("ghost")\n',
        pieces: [{ ...root, name: "trunk", originalName: "Trunk" }],
        rootPieceId: root.id,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /1 check/ }));
    expect(screen.getByText(/has no piece called/)).toBeTruthy();
  });
});

describe("a unit still on the generated script", () => {
  it("shows it to read rather than to edit", () => {
    show(unit());
    expect(screen.getByRole("textbox")).toHaveProperty("readOnly", true);
    expect(screen.getByText(/Generated from the animations/)).toBeTruthy();
  });

  it("offers to take it over, and says the presets stop applying", () => {
    show(unit());
    expect(
      screen.getByRole("button", { name: /Take ownership of this script/ }),
    ).toBeTruthy();
    expect(screen.getByText(/presets stop applying/)).toBeTruthy();
  });

  it("says the script can be handed back later", () => {
    show(unit());
    expect(screen.getByText(/hand\s+the script back later/)).toBeTruthy();
  });

  it("offers no way back while there is nothing to hand back", () => {
    show(unit());
    expect(
      screen.queryByRole("button", {
        name: "Discard this script and use the presets",
      }),
    ).toBeNull();
  });
});

describe("a unit that owns its script", () => {
  it("edits it in place", () => {
    show(unit({ script: "-- mine\n" }));
    const box = screen.getByRole("textbox");
    expect(box).toHaveProperty("value", "-- mine\n");
    expect(box).toHaveProperty("readOnly", false);
  });

  it("commits an edit on blur", () => {
    show(unit({ script: "-- mine\n" }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "-- changed\n" } });
    expect(onScriptChange).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onScriptChange).toHaveBeenCalledWith("-- changed\n");
  });

  it("does not commit when nothing changed", () => {
    show(unit({ script: "-- mine\n" }));
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onScriptChange).not.toHaveBeenCalled();
  });

  it("hands it back", () => {
    show(unit({ script: "-- mine\n" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard this script and use the presets",
      }),
    );

    expect(onScriptRelease).toHaveBeenCalledTimes(1);
  });

  it("says the text goes and that undo brings it back", () => {
    show(unit({ script: "-- mine\n" }));
    expect(screen.getByText(/The text above is discarded/)).toBeTruthy();
    expect(screen.getByText(/Undo brings it back/)).toBeTruthy();
  });

  it("says so plainly when the owned script is empty", () => {
    show(unit({ script: "" }));
    expect(screen.getByText(/This script is empty/)).toBeTruthy();
    expect(screen.getByText(/Animation panel works again/)).toBeTruthy();
  });

  it("says nothing of the sort about a script with something in it", () => {
    show(unit({ script: "-- mine\n" }));
    expect(screen.queryByText(/This script is empty/)).toBeNull();
  });
});

describe("a unit whose game compiled its animation", () => {
  const BOS = "piece base;\n\nCreate()\n{\n\treturn;\n}";

  /** A unit carrying a game's compiled script, with the archive it came out
   *  of still named on it, which is what a reload needs. */
  function fromGame(): LegoProject {
    const base = unit({
      compiledScript: { member: "scripts/walker.cob", bytes: [1] },
    });
    return {
      ...base,
      imported: {
        ...(base.imported ?? {}),
        game: {
          name: "Walkers",
          archive: "walkers.sdd",
          member: "objects3d/walker.s3o",
          unit: "walker",
        },
      } as LegoProject["imported"],
    };
  }

  it("shows the BOS it was built from, not the opcodes, and not to edit", async () => {
    decompileBytes.mockResolvedValue({ source: BOS, warnings: [] });
    show(
      unit({ compiledScript: { member: "scripts/walker.cob", bytes: [1] } }),
    );

    await waitFor(() =>
      expect(
        (screen.getByRole("textbox") as HTMLTextAreaElement).value,
      ).toContain("Create()"),
    );
    expect(screen.getByRole("textbox")).toHaveProperty("readOnly", true);
  });

  it("names the game's own file rather than a .lua it would never write", async () => {
    decompileBytes.mockResolvedValue({ source: BOS, warnings: [] });
    show(
      unit({ compiledScript: { member: "scripts/walker.cob", bytes: [1] } }),
    );

    await waitFor(() =>
      expect(screen.getByText("scripts/walker.cob")).toBeTruthy(),
    );
    expect(screen.queryByText(/\.lua/)).toBeNull();
  });

  it("leaves out the export note, which is about a script coilbox writes", async () => {
    decompileBytes.mockResolvedValue({ source: BOS, warnings: [] });
    show(
      unit({ compiledScript: { member: "scripts/walker.cob", bytes: [1] } }),
    );

    await waitFor(() =>
      expect(screen.getByText("scripts/walker.cob")).toBeTruthy(),
    );
    expect(screen.queryByText(/Export writes it/)).toBeNull();
    expect(screen.queryByText(/compiled rather than Lua/)).toBeNull();
  });

  it("offers no coverage toggle, since a run's lines are not these lines", async () => {
    decompileBytes.mockResolvedValue({ source: BOS, warnings: [] });
    show(
      unit({ compiledScript: { member: "scripts/walker.cob", bytes: [1] } }),
    );

    await waitFor(() =>
      expect(screen.getByText("scripts/walker.cob")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Show what ran")).toBeNull();
  });

  it("reads the game's file again on Reload, for a folder still being worked in", async () => {
    decompileBytes.mockResolvedValue({ source: BOS, warnings: [] });
    const fresh = { member: "scripts/walker.cob", bytes: [9] };
    adopt.mockResolvedValue({ compiled: fresh, notes: [] });
    show(fromGame());

    await waitFor(() =>
      expect(screen.getByText("scripts/walker.cob")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(onCompiledReload).toHaveBeenCalledWith(fresh));
  });

  it("says why nothing changed when the game no longer has the script", async () => {
    decompileBytes.mockResolvedValue({ source: BOS, warnings: [] });
    adopt.mockResolvedValue({
      compiled: null,
      notes: ["The archive would not mount."],
    });
    show(fromGame());

    await waitFor(() =>
      expect(screen.getByText("scripts/walker.cob")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(screen.getByText("The archive would not mount.")).toBeTruthy(),
    );
    expect(onCompiledReload).not.toHaveBeenCalled();
  });

  it("offers no Reload for a unit with no game behind it", async () => {
    decompileBytes.mockResolvedValue({ source: BOS, warnings: [] });
    show(
      unit({ compiledScript: { member: "scripts/walker.cob", bytes: [1] } }),
    );

    await waitFor(() =>
      expect(screen.getByText("scripts/walker.cob")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("offers no Reload with no engine configured to mount the archive", async () => {
    preferredTarget.mockReturnValue({ target: undefined });
    decompileBytes.mockResolvedValue({ source: BOS, warnings: [] });
    show(fromGame());

    await waitFor(() =>
      expect(screen.getByText("scripts/walker.cob")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("says so when the rebuild fails, rather than showing an empty box", async () => {
    decompileBytes.mockRejectedValue(new Error("bad header"));
    show(
      unit({ compiledScript: { member: "scripts/walker.cob", bytes: [1] } }),
    );

    await waitFor(() =>
      expect(screen.getByText(/could not be read back as BOS/)).toBeTruthy(),
    );
  });
});

describe("coverage dimming", () => {
  /** A script with a line that ran and a line that did not, so the dimming
   *  can be told apart from "everything is dimmed" or "nothing is". */
  const SCRIPT = "function script.Create()\n  DoStuff()\nend\n";

  function timeline(over: Partial<ScriptTimeline> = {}): ScriptTimeline {
    return {
      fps: 30,
      pieces: [],
      frames: [],
      hidden: [],
      error: null,
      warnings: [],
      asked: [],
      functions: [],
      linesRun: [],
      offsetsRun: [],
      events: [],
      ...over,
    };
  }

  it("dims a line the run never reached, and not the ones it did", () => {
    const { container } = show(
      unit({ script: SCRIPT }),
      timeline({ linesRun: [1, 3] }),
    );
    // Line 2, "  DoStuff()", is the only line holding code that is missing
    // from linesRun.
    expect(dimmedLineCount(container)).toBe(1);
  });

  it("is disabled with nothing to show until a run exists", () => {
    const { container } = show(unit({ script: SCRIPT }), null);
    expect(
      screen.getByRole("switch", { name: "Show what ran" }),
    ).toHaveProperty("disabled", true);
    expect(dimmedLineCount(container)).toBe(0);
  });

  it("hides the dimming when the toggle is switched off", () => {
    const { container } = show(
      unit({ script: SCRIPT }),
      timeline({ linesRun: [1, 3] }),
    );
    expect(dimmedLineCount(container)).toBe(1);

    fireEvent.click(screen.getByRole("switch", { name: "Show what ran" }));

    expect(dimmedLineCount(container)).toBe(0);
  });

  it("stops dimming once the text on screen is not what was run", () => {
    show(unit({ script: SCRIPT }), timeline({ linesRun: [1, 3] }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: `${SCRIPT}-- one more line\n` },
    });

    expect(
      screen.getByRole("switch", { name: "Show what ran" }),
    ).toHaveProperty("disabled", true);
  });
});
