// @vitest-environment happy-dom

/**
 * The unit's game in the builder (issue #3257): "No game" is a choice, a game
 * can be chosen later, and leaving the game a unit's pieces came from is
 * refused.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LegoProject, newProject } from "../../model";
import { UnitGamePicker } from "./UnitGamePicker";

const testGame = vi.fn();
vi.mock("./useTestGame", () => ({ useTestGame: () => testGame() }));

const SF = {
  name: "Splinter Faction 0.1.89",
  primaryArchive: { name: "SplinterFaction_0.1.89.sdz" },
  dependencyArchives: [],
  info: { shortname: "SF", version: "0.1.89" },
};
const XTA = {
  name: "XTA 9.8",
  primaryArchive: { name: "xta_9.8.sdz" },
  dependencyArchives: [],
  info: { shortname: "XTA" },
};

function project(over: Partial<LegoProject> = {}): LegoProject {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Rover",
      packId: "lego",
      packVersion: "1",
      game: null,
      now: "2026-10-17T00:00:00Z",
    }),
    ...over,
  };
}

const onChange = vi.fn();

function pick(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Game" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

beforeEach(() => {
  testGame.mockReturnValue({
    games: [SF, XTA],
    scan: { data: { games: [SF, XTA] } },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UnitGamePicker", () => {
  it("shows No game for a unit for no game", () => {
    render(<UnitGamePicker project={project()} onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "Game" }).textContent).toBe(
      "No game",
    );
  });

  it("records the game chosen, short name and version included", () => {
    render(<UnitGamePicker project={project()} onChange={onChange} />);
    pick("XTA 9.8");
    expect(onChange).toHaveBeenCalledWith({
      name: "XTA 9.8",
      archive: "xta_9.8.sdz",
      shortname: "XTA",
    });
  });

  it("goes back to No game", () => {
    const game = { name: XTA.name, archive: XTA.primaryArchive.name };
    render(<UnitGamePicker project={project({ game })} onChange={onChange} />);
    pick("No game");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("names a recorded game that is not installed", () => {
    const game = { name: "Gone 1", archive: "gone.sdz" };
    render(<UnitGamePicker project={project({ game })} onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "Game" }).textContent).toBe(
      "Gone 1 (not installed)",
    );
  });

  it("refuses to leave the game a unit's pieces came from", () => {
    const base = project({
      game: undefined,
      imported: {
        source: "x.s3o",
        game: {
          name: SF.name,
          archive: SF.primaryArchive.name,
          member: "objects3d/a.s3o",
        },
      },
    });
    const unit = {
      ...base,
      pieces: [{ ...base.pieces[0], meshId: "m0" }],
    };
    render(<UnitGamePicker project={unit} onChange={onChange} />);
    pick("XTA 9.8");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Remove the pieces from Splinter Faction 0.1.89 first: base.",
    );
  });
});
