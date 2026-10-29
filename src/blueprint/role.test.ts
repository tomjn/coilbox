import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUILDING_CSS,
  BUILDING_RGB,
  type BuildingRole,
  buildingRole,
  buildingRoles,
  ROLE_RGB,
  type RoleUnit,
  roleColor,
  roleCss,
} from "./role";

const gun = { damage: 10, range: 300 };

function unit(
  stats: Record<string, unknown>,
  extra: Partial<RoleUnit> = {},
): RoleUnit {
  return { stats, ...extra };
}

describe("buildingRole", () => {
  it("calls a unit the def says builds a builder", () => {
    expect(buildingRole(unit({ builder: true }))).toBe("builder");
  });

  it("calls a unit with a build menu a builder, armed or not", () => {
    expect(
      buildingRole(unit({ weapons: [gun] }, { buildOptions: ["armsolar"] })),
    ).toBe("builder");
  });

  it("reads an empty build menu as no build menu", () => {
    expect(buildingRole(unit({}, { buildOptions: [] }))).toBe("other");
  });

  it("calls an armed building a weapon before anything it makes", () => {
    expect(buildingRole(unit({ weapons: [gun], energyMake: 20 }))).toBe(
      "weapon",
    );
  });

  it("reads an empty weapon list as unarmed", () => {
    expect(buildingRole(unit({ weapons: [] }))).toBe("other");
  });

  it.each([
    ["energyMake", 20],
    ["windGenerator", 25],
    ["tidalGenerator", 18],
    ["energyUpkeep", -20],
  ])("calls a building with %s %d energy", (key, value) => {
    expect(buildingRole(unit({ [key]: value }))).toBe("energy");
  });

  it("does not call a building that spends energy an energy building", () => {
    expect(buildingRole(unit({ energyUpkeep: 5, energyMake: 0 }))).toBe(
      "other",
    );
  });

  it("calls a unit the dataset says nothing about other", () => {
    expect(buildingRole({})).toBe("other");
  });
});

describe("buildingRoles", () => {
  it("looks a def up whatever case the layout wrote it in", () => {
    const roleOf = buildingRoles([
      { name: "armsolar", stats: { energyMake: 20 } },
    ]);
    expect(roleOf("ARMSolar")).toBe("energy");
  });

  it("knows nothing about a def the game has not got", () => {
    expect(buildingRoles([])("armsolar")).toBeUndefined();
  });
});

describe("role colours", () => {
  it("leaves a building that is none of the three in the drawing's colour", () => {
    expect(roleColor("other")).toBeUndefined();
    expect(roleCss("other")).toBeUndefined();
  });

  it("writes each colour as CSS", () => {
    expect(roleCss("builder")).toBe("#66cc66");
    expect(roleCss("weapon")).toBe("#e65447");
    expect(roleCss("energy")).toBe("#f2cc40");
  });

  // The widget is what these colours are copied from, so a change to its
  // palette fails here rather than leaving the app drawing the old one.
  it("matches the in-game widget's palette", () => {
    const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const lua = readFileSync(
      join(repo, "lua/blueprint-widget/luaui/coilbox_blueprints/model.lua"),
      "utf8",
    );
    for (const role of Object.keys(ROLE_RGB) as Exclude<
      BuildingRole,
      "other"
    >[]) {
      const line = lua.match(
        new RegExp(`^\\s*${role}\\s*=\\s*\\{([^}]*)\\}`, "m"),
      );
      expect(line, role).not.toBeNull();
      const [r, g, b] = (line?.[1] ?? "").split(",").map(Number);
      expect([r, g, b], role).toEqual(ROLE_RGB[role]);
    }
    const building = lua.match(/^\s*building\s*=\s*\{([^}]*)\}/m);
    expect(building).not.toBeNull();
    const [r, g, b] = (building?.[1] ?? "").split(",").map(Number);
    expect([r, g, b]).toEqual(BUILDING_RGB);
  });

  it("writes the building colour as CSS", () => {
    expect(BUILDING_CSS).toBe("#73a8bd");
  });
});
