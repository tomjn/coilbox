import { describe, expect, it } from "vitest";
import { engineFields } from "@/content/unitFields";
import { setOverride, type UnitOverrides } from "./overrides";
import { presentPaths, UNIT_FIELD_GROUPS, unitFieldView } from "./unitSections";

const registryPaths = engineFields("unit").map((f) =>
  f.section === "" ? f.key : `${f.section}.${f.key}`,
);

/**
 * A small unit, spelled the way the engine's C++ writes its keys.
 *
 * Real games do not arrive like this. See {@link lowercased} below, which is
 * what a def actually looks like coming out of `gamedata/defs.lua`. Both
 * spellings are kept because the page has to resolve either.
 */
const armcom: Record<string, unknown> = {
  name: "armcom",
  health: 3000,
  metalCost: 1200,
  buildTime: 60000,
  sightDistance: 500,
  objectName: "armcom.s3o",
  collisionVolume: { type: "b", scales: [30, 40, 30] },
  weapons: [{ name: "disintegrator" }, { name: "armcomlaser", slaveTo: 1 }],
  customParams: { model_author: "somebody" },
  somethingOnlyThisGameReads: 4,
};

/**
 * One unit as Balanced Annihilation's own def pipeline hands it over, keys and
 * all. Every key is lowercase, `maxdamage` stands in for health, and the
 * collision volume is three flat keys rather than a table.
 */
const lowercased: Record<string, unknown> = {
  name: "armcom",
  maxdamage: 3000,
  buildcostmetal: 2667,
  buildtime: 60000,
  sightdistance: 500,
  objectname: "armcom.s3o",
  collisionvolumescales: "110 71 67",
  weapons: [
    { name: "armcom_armcomlaser", onlytargetcategory: "NOTSUB" },
    { badtargetcategory: "VTOL", name: "armcom_armcomsealaser" },
  ],
  customparams: { iscommander: true },
  commander: true,
};

describe("UNIT_FIELD_GROUPS", () => {
  it("only places paths the engine actually declares", () => {
    const known = new Set(registryPaths);
    const placed = UNIT_FIELD_GROUPS.flatMap((g) =>
      g.sections.flatMap((s) => s.paths),
    );
    expect(placed.filter((p) => !known.has(p))).toEqual([]);
  });

  it("places each path once", () => {
    const placed = UNIT_FIELD_GROUPS.flatMap((g) =>
      g.sections.flatMap((s) => s.paths),
    );
    expect(placed.length).toBe(new Set(placed).size);
  });

  it("leaves only container tables unplaced, whose children carry the fields", () => {
    const placed = new Set(
      UNIT_FIELD_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.paths)),
    );
    const unplaced = registryPaths.filter((p) => !placed.has(p));
    expect(unplaced.sort()).toEqual(
      [
        "SFXTypes",
        "collisionVolume",
        "selectionVolume",
        "sounds",
        "weapons",
      ].sort(),
    );
  });
});

describe("presentPaths", () => {
  it("walks into tables the registry knows and stops at the leaves", () => {
    const paths = presentPaths(armcom);
    expect(paths).toContain("collisionVolume.type");
    expect(paths).toContain("weapons.0.name");
    expect(paths).toContain("weapons.1.slaveTo");
    expect(paths).not.toContain("weapons");
    expect(paths).not.toContain("collisionVolume");
  });

  it("keeps a float3 whole rather than splitting it into three rows", () => {
    expect(presentPaths(armcom)).toContain("collisionVolume.scales");
    expect(presentPaths(armcom)).not.toContain("collisionVolume.scales.0");
  });

  it("stops at a table the engine reads whole", () => {
    const paths = presentPaths(armcom);
    expect(paths).toContain("customParams");
    expect(paths).not.toContain("customParams.model_author");
  });

  it("keeps a key only the game declares", () => {
    expect(presentPaths(armcom)).toContain("somethingOnlyThisGameReads");
  });
});

describe("unitFieldView", () => {
  const rowsOf = (view: ReturnType<typeof unitFieldView>) =>
    view.groups.flatMap((g) => g.sections.flatMap((s) => s.rows));

  it("draws only what the unit declares in the relevant view", () => {
    const view = unitFieldView(armcom, {}, "armcom", "relevant");
    const paths = rowsOf(view).map((r) => r.path);
    expect(paths.sort()).toEqual(presentPaths(armcom).sort());
    expect(view.shown).toBe(presentPaths(armcom).length);
  });

  it("counts the fields the relevant view is not drawing", () => {
    const view = unitFieldView(armcom, {}, "armcom", "relevant");
    const all = unitFieldView(armcom, {}, "armcom", "all");
    expect(view.hidden).toBeGreaterThan(0);
    expect(view.shown + view.hidden).toBe(all.shown);
    // The count reads the same in either view, so the switch says the same
    // thing whichever way it is pointing.
    expect(all.hidden).toBe(view.hidden);
  });

  it("adds every engine key in the all view, minus the container tables", () => {
    const paths = new Set(
      rowsOf(unitFieldView(armcom, {}, "armcom", "all")).map((r) => r.path),
    );
    expect(paths.has("radarDistance")).toBe(true);
    expect(paths.has("cloakCost")).toBe(true);
    expect(paths.has("weapons")).toBe(false);
    // A pattern is not a path, so it only appears where the def has an entry.
    expect(paths.has("weapons.*.name")).toBe(false);
    expect(paths.has("weapons.0.name")).toBe(true);
  });

  it("puts a field in the section its group names", () => {
    const view = unitFieldView(armcom, {}, "armcom", "relevant");
    const sectionOf = (path: string) =>
      view.groups
        .flatMap((g) => g.sections.map((s) => ({ group: g.id, section: s })))
        .find((s) => s.section.rows.some((r) => r.path === path));
    expect(sectionOf("health")).toMatchObject({
      group: "economy",
      section: { id: "durability" },
    });
    expect(sectionOf("sightDistance")).toMatchObject({
      group: "movement",
      section: { id: "sensors" },
    });
    expect(sectionOf("weapons.0.name")).toMatchObject({
      group: "weapons",
      section: { id: "weapons" },
    });
    expect(sectionOf("objectName")).toMatchObject({
      group: "presentation",
      section: { id: "assets" },
    });
  });

  it("falls a key only the game declares back to a raw row of its own", () => {
    const view = unitFieldView(armcom, {}, "armcom", "relevant");
    const row = view.groups
      .flatMap((g) => g.sections)
      .find((s) => s.id === "game")
      ?.rows.find((r) => r.path === "somethingOnlyThisGameReads");
    expect(row?.field.known).toBe(false);
    expect(row?.label).toBe("somethingOnlyThisGameReads");
    expect(row?.value).toBe(4);
  });

  it("orders weapon rows by mount and labels which one they belong to", () => {
    const rows = unitFieldView(armcom, {}, "armcom", "relevant")
      .groups.flatMap((g) => g.sections)
      .find((s) => s.id === "weapons")?.rows;
    expect(rows?.map((r) => r.path)).toEqual([
      "weapons.0.name",
      "weapons.1.name",
      "weapons.1.slaveTo",
    ]);
    expect(rows?.[0].label).toBe("name (weapon 1)");
    expect(rows?.[1].label).toBe("name (weapon 2)");
  });

  it("inherits the game's value where the def has one, and the engine's where it does not", () => {
    const rows = rowsOf(unitFieldView(armcom, {}, "armcom", "all"));
    const health = rows.find((r) => r.path === "health");
    expect(health).toMatchObject({
      present: true,
      inherited: 3000,
      value: 3000,
    });
    const radar = rows.find((r) => r.path === "radarDistance");
    expect(radar).toMatchObject({ present: false, inherited: 0, value: 0 });
  });

  it("marks an overridden field and shows the user's value over the game's", () => {
    const overrides = setOverride({}, "armcom", "health", 5000, 3000);
    const rows = rowsOf(unitFieldView(armcom, overrides, "armcom", "relevant"));
    const health = rows.find((r) => r.path === "health");
    expect(health).toMatchObject({
      state: "overridden",
      inherited: 3000,
      value: 5000,
    });
    // Every other field is still inherited, and reading them changed nothing.
    expect(rows.filter((r) => r.state === "overridden")).toHaveLength(1);
  });

  it("keeps showing a field the user overrode onto a key the def never had", () => {
    const overrides: UnitOverrides = setOverride(
      {},
      "armcom",
      "radarDistance",
      1000,
      0,
    );
    const rows = rowsOf(unitFieldView(armcom, overrides, "armcom", "relevant"));
    const radar = rows.find((r) => r.path === "radarDistance");
    expect(radar).toMatchObject({
      present: false,
      state: "overridden",
      inherited: 0,
      value: 1000,
    });
  });

  /**
   * The case a first run against a real game caught. `gamedata/defs.lua`
   * lowercases every key, so matching on the registry's own C++ spelling made
   * all 80 of a unit's fields unknown and dumped them into one raw list.
   */
  describe("a game's own lowercase spelling", () => {
    it("resolves to the engine field it names", () => {
      const rows = rowsOf(unitFieldView(lowercased, {}, "armcom", "relevant"));
      const health = rows.find((r) => r.path === "maxdamage");
      expect(health).toMatchObject({ label: "Health (old name)", value: 3000 });
      expect(health?.field.known).toBe(true);
      expect(rows.find((r) => r.path === "buildcostmetal")?.field.known).toBe(
        true,
      );
      expect(rows.find((r) => r.path === "sightdistance")?.label).toBe(
        "Line of sight",
      );
    });

    it("still groups by section rather than falling to the raw list", () => {
      const view = unitFieldView(lowercased, {}, "armcom", "relevant");
      const raw = view.groups
        .flatMap((g) => g.sections)
        .find((s) => s.id === "game");
      // Only the keys the engine genuinely does not declare.
      expect(raw?.rows.map((r) => r.path)).toEqual(["commander"]);
    });

    it("does not draw the same field twice in the all view", () => {
      const paths = rowsOf(unitFieldView(lowercased, {}, "armcom", "all")).map(
        (r) => r.path,
      );
      expect(paths.filter((p) => p.toLowerCase() === "maxdamage")).toEqual([
        "maxdamage",
      ]);
      expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(
        paths.length,
      );
    });

    it("keeps each weapon mount as its own row", () => {
      const rows = unitFieldView(lowercased, {}, "armcom", "relevant")
        .groups.flatMap((g) => g.sections)
        .find((s) => s.id === "weapons")?.rows;
      expect(rows?.map((r) => r.path)).toEqual([
        "weapons.0.name",
        "weapons.0.onlytargetcategory",
        "weapons.1.name",
        "weapons.1.badtargetcategory",
      ]);
      expect(rows?.[1].label).toBe("onlyTargetCategory (weapon 1)");
    });

    it("stops at an open table however the game spells it", () => {
      const paths = presentPaths(lowercased);
      expect(paths).toContain("customparams");
      expect(paths).not.toContain("customparams.iscommander");
    });
  });

  it("draws nothing for a unit the game does not have", () => {
    const view = unitFieldView(undefined, {}, "nothing", "relevant");
    expect(view.groups).toEqual([]);
    expect(view.shown).toBe(0);
  });
});
