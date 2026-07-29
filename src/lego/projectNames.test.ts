import { describe, expect, it } from "vitest";

import { newProject } from "./model";
import { validateProjectName } from "./projectNames";

function project(id: string, name: string) {
  return newProject({
    id,
    rootPieceId: "root",
    name,
    packId: "lego",
    packVersion: "1",
    now: "2026-07-29T00:00:00Z",
  });
}

describe("validateProjectName", () => {
  const projects = [project("a", "turret walker"), project("b", "wheel car")];

  it("accepts a name nothing else is using", () => {
    expect(validateProjectName(projects, "a", "hull carrier")).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(validateProjectName(projects, "a", "   ")).toBe(
      "Name cannot be empty",
    );
  });

  it("rejects a name another unit already has, regardless of case", () => {
    expect(validateProjectName(projects, "a", "Wheel Car")).toBe(
      "Another unit already has this name",
    );
  });

  it("does not clash with the unit's own current name", () => {
    expect(validateProjectName(projects, "a", "turret walker")).toBeNull();
  });
});
