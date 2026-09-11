// @vitest-environment happy-dom

/**
 * The script drawer: reading the generated script, taking it over, and giving
 * it back.
 *
 * Handing it back is the one worth covering closely. It discards text somebody
 * wrote, and the case it exists for is a unit whose owned script is empty:
 * that unit animates nothing, cannot be reached by a preset, and before this
 * could only be rescued by editing files on disk.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../../model";
import { newProject } from "../../model";
import { ScriptDrawer } from "./ScriptDrawer";

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

const onOpenChange = vi.fn();
const onScriptChange = vi.fn();
const onScriptRelease = vi.fn();

function show(project: LegoProject) {
  return render(
    <ScriptDrawer
      open
      onOpenChange={onOpenChange}
      project={project}
      onScriptChange={onScriptChange}
      onScriptRelease={onScriptRelease}
    />,
  );
}

beforeEach(() => {
  onOpenChange.mockClear();
  onScriptChange.mockClear();
  onScriptRelease.mockClear();
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
 *
 * flove is where this showed. Its models name a piece `Trunk` and its unit
 * definitions ask for `Trunk`, and the check was reading the lower case list.
 */
describe("a unit whose pieces have two spellings", () => {
  /** Asserted against the whole document, because the warning is built from a
   *  sentence and a list of names rather than one text node. */
  function warned(): boolean {
    return (document.body.textContent ?? "").includes("has no piece called");
  }

  it("does not warn when a script names a piece as its model file spells it", () => {
    const [root] = unit().pieces;
    show(
      unit({
        script: 'local trunk = piece("Trunk")\n',
        pieces: [{ ...root, name: "trunk", originalName: "Trunk" }],
        rootPieceId: root.id,
      }),
    );
    expect(warned()).toBe(false);
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
    expect(warned()).toBe(true);
  });
});

describe("a unit still on the generated script", () => {
  // By role, not by label: the drawer's own title is `walker.lua` too, and
  // Radix points the dialog's `aria-labelledby` at it.
  it("shows it to read rather than to edit", () => {
    show(unit());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/Generated from the animations/)).toBeTruthy();
  });

  it("offers to take it over, and says the presets stop applying", () => {
    show(unit());
    expect(
      screen.getByRole("button", { name: "Take ownership of this script" }),
    ).toBeTruthy();
    expect(screen.getByText(/presets stop applying/)).toBeTruthy();
  });

  /** It used to say there was no way back. There is one now, and promising a
   *  one way door would put people off a reversible choice. */
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
    expect(screen.getByRole("textbox")).toHaveProperty("value", "-- mine\n");
  });

  it("hands it back and closes, so the animation panel is what you land on", () => {
    show(unit({ script: "-- mine\n" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard this script and use the presets",
      }),
    );

    expect(onScriptRelease).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says the text goes and that undo brings it back", () => {
    show(unit({ script: "-- mine\n" }));
    expect(screen.getByText(/The text above is discarded/)).toBeTruthy();
    expect(screen.getByText(/Undo brings it back/)).toBeTruthy();
  });

  /**
   * The case that made this necessary. An empty owned script is not an unusual
   * edit, it is a unit with no animation and no way to ask for one, so the
   * drawer names that rather than leaving it to be worked out.
   */
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
