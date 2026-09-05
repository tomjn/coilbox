import { describe, expect, it } from "vitest";

import type { BaseBlueprint } from "@/blueprint/model";
import { addBuilding, removeBuilding } from "@/lib/scenarioEditing/bases";
import { movePlacement } from "@/lib/scenarioEditing/editing";
import {
  BLUEPRINT_BASE_ID,
  blueprintDocument,
  documentLayout,
} from "./blueprintDocument";
import { GRID_ORIGIN } from "./ground";
import { placementKey } from "./placements";

const layout: BaseBlueprint = {
  id: "layout-1",
  name: "Opening",
  buildings: [
    { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
    { def: "armlab", offset: { x: 128, z: 0 }, facing: 0 },
  ],
};

describe("blueprintDocument", () => {
  it("names no map, because a blueprint is not made for one", () => {
    const doc = blueprintDocument(layout, "Some Game");
    expect(doc.setup.mapName).toBe("");
    expect(doc.setup.gameName).toBe("Some Game");
  });

  it("places the layout once, in the middle of the ground", () => {
    const doc = blueprintDocument(layout, "Some Game");
    expect(doc.blueprints).toEqual([layout]);
    expect(doc.bases).toHaveLength(1);
    expect(doc.bases[0].id).toBe(BLUEPRINT_BASE_ID);
    expect(doc.bases[0].blueprint).toBe(layout.id);
    expect(doc.bases[0].origin).toEqual(GRID_ORIGIN);
  });

  it("carries one team, so a building has an owner to be drawn in", () => {
    const doc = blueprintDocument(layout, "Some Game");
    expect(doc.setup.participants).toHaveLength(1);
    expect(doc.bases[0].team).toBe(doc.setup.participants[0].id);
  });

  it("holds nothing a mission holds", () => {
    const doc = blueprintDocument(layout, "Some Game");
    expect(doc.actors).toEqual([]);
    expect(doc.groups).toEqual([]);
    expect(doc.zones).toEqual([]);
    expect(doc.triggers).toEqual([]);
    expect(doc.objectives).toEqual([]);
  });
});

describe("documentLayout", () => {
  it("reads back exactly what went in when nothing was edited", () => {
    const doc = blueprintDocument(layout, "Some Game");
    expect(documentLayout(doc, layout)).toEqual(layout);
  });

  it("reads back an edit made through the placement surface", () => {
    const doc = blueprintDocument(layout, "Some Game");
    const moved = movePlacement(
      doc,
      placementKey("base", BLUEPRINT_BASE_ID, 1),
      { x: 64, z: 0 },
    );
    expect(documentLayout(moved, layout).buildings[1].offset).toEqual({
      x: 192,
      z: 0,
    });
  });

  it("keeps a building added through the surface", () => {
    const doc = blueprintDocument(layout, "Some Game");
    const added = addBuilding(doc, BLUEPRINT_BASE_ID, {
      def: "armwin",
      offset: { x: 0, z: 128 },
      facing: 1,
    });
    expect(documentLayout(added, layout).buildings).toHaveLength(3);
    expect(documentLayout(added, layout).buildings[2].def).toBe("armwin");
  });

  it("is an empty layout once the last building is deleted", () => {
    // Deleting a base's last building deletes the base, and the layout goes
    // with it. Standalone that is not a base disappearing, it is a layout with
    // nothing in it yet, which is where a new blueprint starts anyway.
    const one = blueprintDocument(
      { ...layout, buildings: [layout.buildings[0]] },
      "Some Game",
    );
    const emptied = removeBuilding(one, BLUEPRINT_BASE_ID, 0);
    expect(emptied.bases).toEqual([]);
    expect(documentLayout(emptied, layout)).toEqual({
      ...layout,
      buildings: [],
    });
  });

  it("keeps the layout's own name and build order flag through an emptying", () => {
    const ordered: BaseBlueprint = {
      ...layout,
      ordered: true,
      buildings: [layout.buildings[0]],
    };
    const emptied = removeBuilding(
      blueprintDocument(ordered, "Some Game"),
      BLUEPRINT_BASE_ID,
      0,
    );
    const read = documentLayout(emptied, ordered);
    expect(read.name).toBe("Opening");
    expect(read.ordered).toBe(true);
    expect(read.id).toBe("layout-1");
  });
});
