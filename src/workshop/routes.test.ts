import { describe, expect, it } from "vitest";
import { EMPTY_EDITS, type ModProject } from "./project";
import { newestProjectForGame, projectPath, unitEditPath } from "./routes";

function project(fields: Partial<ModProject> & { id: string }): ModProject {
  return {
    name: fields.id,
    gameName: "Balanced Annihilation",
    edits: EMPTY_EDITS,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

describe("newestProjectForGame", () => {
  it("answers nothing when the game has no project", () => {
    expect(newestProjectForGame([], "Balanced Annihilation")).toBeUndefined();
  });

  it("ignores another game's projects entirely", () => {
    const other = project({ id: "bar", gameName: "Beyond All Reason" });
    expect(
      newestProjectForGame([other], "Balanced Annihilation"),
    ).toBeUndefined();
  });

  it("takes the one written to last", () => {
    const old = project({ id: "old", updatedAt: "2026-01-01T00:00:00.000Z" });
    const recent = project({
      id: "recent",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(
      newestProjectForGame([old, recent], "Balanced Annihilation")?.id,
    ).toBe("recent");
  });

  /** A project and a copy of it share `updatedAt`, because copying changed
   *  none of the edits. Landing in the copy would be a surprise. */
  it("prefers the older of two written at the same moment", () => {
    const source = project({ id: "source" });
    const copy = project({ id: "copy", createdAt: "2026-03-01T00:00:00.000Z" });
    expect(
      newestProjectForGame([copy, source], "Balanced Annihilation")?.id,
    ).toBe("source");
  });
});

describe("unitEditPath", () => {
  it("opens the game's own project on the unit", () => {
    const saved = project({ id: "abc" });
    expect(unitEditPath([saved], "Balanced Annihilation", "armcom")).toBe(
      "/workshop/abc?unit=armcom",
    );
  });

  /** The one answer that must not happen is a list with the unit lost. */
  it("opens the editor with no project when the game has none", () => {
    expect(unitEditPath([], "Beyond All Reason test-1234", "armaak")).toBe(
      "/workshop/new?game=Beyond+All+Reason+test-1234&unit=armaak",
    );
  });
});

describe("projectPath", () => {
  it("names no unit when there is none to name", () => {
    expect(projectPath("abc")).toBe("/workshop/abc");
  });
});
