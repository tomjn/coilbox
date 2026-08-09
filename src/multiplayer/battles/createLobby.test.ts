import { describe, expect, it } from "vitest";
import {
  ALLY_TEAM_RANGE,
  type NewLobbyForm,
  newLobbyProblem,
  PLAYERS_PER_TEAM_RANGE,
  shapeLabel,
} from "./createLobby";

function form(patch: Partial<NewLobbyForm> = {}): NewLobbyForm {
  return {
    name: "Comet Catcher 8v8",
    mapName: "Comet Catcher Remake 1.8",
    allyTeams: 2,
    playersPerTeam: 8,
    ...patch,
  };
}

describe("newLobbyProblem", () => {
  it("passes a filled-in form", () => {
    expect(newLobbyProblem(form())).toBeNull();
  });

  it("wants a name that is not only spaces", () => {
    expect(newLobbyProblem(form({ name: "" }))).toBe("Give the lobby a name.");
    expect(newLobbyProblem(form({ name: "   " }))).toBe(
      "Give the lobby a name.",
    );
  });

  it("wants a map, which the server has no default for", () => {
    expect(newLobbyProblem(form({ mapName: "" }))).toBe("Choose a map.");
  });

  it("holds the sides to a match that can be played", () => {
    for (const allyTeams of [0, 1, ALLY_TEAM_RANGE.max + 1, 2.5]) {
      expect(newLobbyProblem(form({ allyTeams }))).toBe(
        "A lobby has between 2 and 8 sides.",
      );
    }
    expect(
      newLobbyProblem(form({ allyTeams: ALLY_TEAM_RANGE.min })),
    ).toBeNull();
    expect(
      newLobbyProblem(form({ allyTeams: ALLY_TEAM_RANGE.max })),
    ).toBeNull();
  });

  it("holds the seats on each side to the same", () => {
    for (const playersPerTeam of [0, PLAYERS_PER_TEAM_RANGE.max + 1, 1.5]) {
      expect(newLobbyProblem(form({ playersPerTeam }))).toBe(
        "Each side takes between 1 and 16 players.",
      );
    }
    expect(
      newLobbyProblem(form({ playersPerTeam: PLAYERS_PER_TEAM_RANGE.min })),
    ).toBeNull();
    expect(
      newLobbyProblem(form({ playersPerTeam: PLAYERS_PER_TEAM_RANGE.max })),
    ).toBeNull();
  });

  it("reports the name before the numbers, so one fix is asked for at a time", () => {
    expect(newLobbyProblem(form({ name: "", allyTeams: 0 }))).toBe(
      "Give the lobby a name.",
    );
  });
});

describe("shapeLabel", () => {
  it("reads the way players say it", () => {
    expect(shapeLabel(2, 8)).toBe("8v8");
    expect(shapeLabel(3, 4)).toBe("4v4v4");
    expect(shapeLabel(2, 1)).toBe("1v1");
  });
});
