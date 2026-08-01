import { describe, expect, it } from "vitest";
import { initialParticipants } from "../../../play/participants";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import {
  applyPresetSetup,
  defsMissingFrom,
  holdsNothing,
  mapCost,
  mapExtent,
  participantHoldings,
  removeScenarioParticipant,
  scaleScenarioToMap,
  scenarioPoints,
  setScenarioGame,
  setScenarioMap,
} from "./setup";

/** A populated document on an 8192 x 8192 map: one of everything that stands
 *  somewhere, and triggers that name both a point and a participant. */
function populated(): Scenario {
  const base = newScenario("test");
  const [you, ai] = base.setup.participants;
  return {
    ...base,
    setup: { ...base.setup, gameName: "Game A", mapName: "Old Map" },
    teams: { [ai.id]: { startUnits: ["armcom"], resources: { metal: 500 } } },
    zones: [
      {
        id: "landing",
        name: "landing",
        shape: "box",
        min: { x: 1024, z: 1024 },
        max: { x: 2048, z: 2048 },
      },
      {
        id: "ring",
        name: "ring",
        shape: "circle",
        center: { x: 4096, z: 4096 },
        radius: 512,
      },
    ],
    actors: [
      {
        id: "hero",
        unitDef: "armcom",
        team: you.id,
        pos: { x: 2048, z: 2048 },
        facing: 0,
      },
      {
        id: "villain",
        unitDef: "corcom",
        team: ai.id,
        pos: { x: 6144, z: 6144 },
        facing: 2,
      },
    ],
    groups: [
      {
        id: "patrol",
        team: ai.id,
        units: [{ def: "corak", count: 4 }],
        pos: { x: 4096, z: 1024 },
        orders: [
          { kind: "patrol", waypoints: [{ x: 4096, z: 2048 }] },
          { kind: "guard", target: "villain" },
        ],
        dormant: false,
      },
    ],
    prefabs: [
      {
        id: "outpost",
        team: ai.id,
        origin: { x: 7168, z: 1024 },
        buildings: [{ def: "corsolar", offset: { x: -128, z: 64 }, facing: 0 }],
      },
    ],
    triggers: [
      {
        id: "trigger-1",
        enabled: true,
        repeat: false,
        conditions: {
          op: "all",
          conditions: [
            { type: "units_in_zone", params: { zone: "landing", team: ai.id } },
          ],
        },
        actions: [
          {
            type: "map_marker",
            params: { pos: { x: 512, z: 6144 }, text: "here" },
          },
          {
            type: "give_orders",
            params: {
              group: "patrol",
              orders: [{ kind: "move", waypoints: [{ x: 1024, z: 4096 }] }],
            },
          },
          { type: "victory", params: { team: you.id } },
        ],
      },
    ],
  };
}

const ids = (s: Scenario) => s.setup.participants.map((p) => p.id);

describe("a map's extent", () => {
  it("reads a scanned map's proportions as elmos", () => {
    expect(mapExtent({ width: 512, height: 256 })).toEqual({
      x: 8192,
      z: 4096,
    });
  });

  it("is unknown when the scan did not report a size", () => {
    expect(mapExtent({ width: 512 })).toBeNull();
    expect(mapExtent(null)).toBeNull();
  });
});

describe("what changing the map costs", () => {
  it("counts everything that stands somewhere", () => {
    expect(mapCost(populated(), null).placed).toBe(6);
  });

  it("counts nothing off a map big enough to hold it", () => {
    expect(mapCost(populated(), { x: 8192, z: 8192 }).offMap).toBe(0);
  });

  it("counts what a smaller map has no room for", () => {
    // Everything at or beyond 4096: the ring zone's centre, the villain, the
    // patrol and its waypoint, the outpost and its building, the map marker and
    // the ordered waypoint.
    expect(mapCost(populated(), { x: 4096, z: 4096 }).offMap).toBe(8);
  });

  it("reports nothing off the map when the new map's size is unknown", () => {
    expect(mapCost(populated(), null).offMap).toBe(0);
  });
});

describe("every coordinate the document holds", () => {
  it("finds the ones inside triggers and prefab buildings", () => {
    const points = scenarioPoints(populated());
    // The ping's point, the give_orders waypoint, and the outpost's building.
    expect(points).toContainEqual({ x: 512, z: 6144 });
    expect(points).toContainEqual({ x: 1024, z: 4096 });
    expect(points).toContainEqual({ x: 7040, z: 1088 });
  });
});

describe("rescaling onto a different map", () => {
  const from = { x: 8192, z: 8192 };
  const to = { x: 4096, z: 4096 };
  const scaled = scaleScenarioToMap(populated(), from, to);

  it("halves every absolute coordinate", () => {
    expect(scaled.actors[0].pos).toEqual({ x: 1024, z: 1024 });
    expect(scaled.groups[0].pos).toEqual({ x: 2048, z: 512 });
    expect(scaled.groups[0].orders[0]).toEqual({
      kind: "patrol",
      waypoints: [{ x: 2048, z: 1024 }],
    });
    expect(scaled.prefabs[0].origin).toEqual({ x: 3584, z: 512 });
    expect(scaled.zones[0]).toMatchObject({
      min: { x: 512, z: 512 },
      max: { x: 1024, z: 1024 },
    });
  });

  it("leaves a base's own layout alone", () => {
    expect(scaled.prefabs[0].buildings[0].offset).toEqual({ x: -128, z: 64 });
  });

  it("rescales a circular zone's radius by the smaller factor", () => {
    expect(scaled.zones[1]).toMatchObject({
      center: { x: 2048, z: 2048 },
      radius: 256,
    });
  });

  it("carries the points inside triggers", () => {
    const [ping, orders] = scaled.triggers[0].actions;
    expect(ping.params.pos).toEqual({ x: 256, z: 3072 });
    expect(orders.params.orders).toEqual([
      { kind: "move", waypoints: [{ x: 512, z: 2048 }] },
    ]);
  });

  it("puts everything it moved on the new map", () => {
    const points = scenarioPoints(scaled);
    expect(points.every((p) => p.x > 0 && p.x < to.x)).toBe(true);
    expect(points.every((p) => p.z > 0 && p.z < to.z)).toBe(true);
  });

  it("never rounds a coordinate onto the map edge", () => {
    // A base's own layout is not rescaled, so a building can still hang off a
    // map this much smaller. Everything the rescale moved is on it.
    const tiny = scaleScenarioToMap(populated(), from, { x: 128, z: 128 });
    const moved = [
      ...tiny.actors.map((a) => a.pos),
      ...tiny.groups.map((g) => g.pos),
      ...tiny.prefabs.map((p) => p.origin),
    ];
    expect(moved.every((p) => p.x >= 1 && p.z >= 1)).toBe(true);
    expect(moved.every((p) => p.x <= 127 && p.z <= 127)).toBe(true);
  });
});

describe("changing the map", () => {
  it("keeps every coordinate where it was", () => {
    const before = populated();
    const next = setScenarioMap(before, "New Map");
    expect(next.setup.mapName).toBe("New Map");
    expect(next.actors).toEqual(before.actors);
  });

  it("hands the document straight back when the map is the same", () => {
    const before = populated();
    expect(setScenarioMap(before, "Old Map")).toBe(before);
  });
});

describe("changing the game", () => {
  it("drops the mod option values the old game's options were keyed by", () => {
    const before = {
      ...populated(),
      setup: {
        ...populated().setup,
        modOptionValues: { deathmode: "killall" },
      },
    };
    const next = setScenarioGame(before, "Game B");
    expect(next.setup.gameName).toBe("Game B");
    expect(next.setup.modOptionValues).toEqual({});
  });

  it("keeps everything the document places", () => {
    const before = populated();
    expect(setScenarioGame(before, "Game B").actors).toEqual(before.actors);
  });

  it("hands the document straight back when the game is the same", () => {
    const before = populated();
    expect(setScenarioGame(before, "Game A")).toBe(before);
  });

  it("names the defs a game does not have, case insensitively", () => {
    expect(
      defsMissingFrom(
        ["armcom", "CORCOM", "corak"],
        [{ name: "ARMCOM" }, { name: "corcom" }],
      ),
    ).toEqual(["corak"]);
  });
});

describe("what a participant holds", () => {
  it("counts everything that names it", () => {
    const scenario = populated();
    const ai = ids(scenario)[1];
    expect(participantHoldings(scenario, ai)).toEqual({
      actors: 1,
      groups: 1,
      prefabs: 1,
      triggers: 1,
      team: true,
    });
  });

  it("counts the triggers that name the player", () => {
    const scenario = populated();
    expect(participantHoldings(scenario, ids(scenario)[0])).toEqual({
      actors: 1,
      groups: 0,
      prefabs: 0,
      triggers: 1,
      team: false,
    });
  });

  it("says a fresh scenario's participants hold nothing", () => {
    const fresh = newScenario("fresh");
    expect(holdsNothing(participantHoldings(fresh, ids(fresh)[1]))).toBe(true);
  });
});

describe("removing a participant", () => {
  it("hands everything it held to another one", () => {
    const scenario = populated();
    const [you, ai] = ids(scenario);
    const next = removeScenarioParticipant(scenario, ai, you);
    expect(ids(next)).toEqual([you]);
    expect(next.actors.every((a) => a.team === you)).toBe(true);
    expect(next.groups[0].team).toBe(you);
    expect(next.prefabs[0].team).toBe(you);
    expect(next.triggers[0].conditions.conditions[0].params.team).toBe(you);
  });

  it("deletes what it held when there is nobody to hand it to", () => {
    const scenario = populated();
    const [you, ai] = ids(scenario);
    const next = removeScenarioParticipant(scenario, ai, null);
    expect(next.actors.map((a) => a.id)).toEqual(["hero"]);
    expect(next.groups).toEqual([]);
    expect(next.prefabs).toEqual([]);
    // The trigger that named it is left alone, exactly as deleting a zone
    // leaves the conditions naming it alone.
    expect(next.triggers[0].conditions.conditions[0].params.team).toBe(ai);
    expect(ids(next)).toEqual([you]);
  });

  it("drops its team settings either way", () => {
    const scenario = populated();
    const [you, ai] = ids(scenario);
    expect(removeScenarioParticipant(scenario, ai, you).teams).toEqual({});
    expect(removeScenarioParticipant(scenario, ai, null).teams).toEqual({});
  });

  it("refuses to remove the player, who is the setup's first row", () => {
    const scenario = populated();
    const [you, ai] = ids(scenario);
    expect(removeScenarioParticipant(scenario, you, ai)).toBe(scenario);
  });

  it("refuses a handover to itself or to nobody in the setup", () => {
    const scenario = populated();
    const ai = ids(scenario)[1];
    expect(removeScenarioParticipant(scenario, ai, ai)).toBe(scenario);
    expect(removeScenarioParticipant(scenario, ai, "nobody")).toBe(scenario);
  });
});

describe("setting up from a preset", () => {
  const preset = () => ({
    participants: initialParticipants(),
    gameName: "Preset Game",
    mapName: "Preset Map",
    startPosType: 2,
    modOptionValues: { deathmode: "killall" },
  });

  it("takes the preset's whole setup", () => {
    const next = applyPresetSetup(populated(), preset());
    expect(next.setup.gameName).toBe("Preset Game");
    expect(next.setup.mapName).toBe("Preset Map");
    expect(next.setup.startPosType).toBe(2);
    expect(next.setup.modOptionValues).toEqual({ deathmode: "killall" });
  });

  it("hands everything over in list order", () => {
    const scenario = populated();
    const incoming = preset();
    const next = applyPresetSetup(scenario, incoming);
    const [you, ai] = next.setup.participants.map((p) => p.id);
    expect(next.actors.map((a) => a.team)).toEqual([you, ai]);
    expect(next.groups[0].team).toBe(ai);
    expect(next.prefabs[0].team).toBe(ai);
    expect(next.triggers[0].conditions.conditions[0].params.team).toBe(ai);
    expect(next.triggers[0].actions[2].params.team).toBe(you);
    expect(Object.keys(next.teams)).toEqual([ai]);
  });

  it("hands a participant the preset has no room for to the player", () => {
    const scenario = populated();
    const third = {
      ...scenario.setup.participants[1],
      id: "extra",
      name: "AI 2",
    };
    const crowded: Scenario = {
      ...scenario,
      setup: {
        ...scenario.setup,
        participants: [...scenario.setup.participants, third],
      },
      actors: [
        ...scenario.actors,
        {
          id: "spare",
          unitDef: "corak",
          team: "extra",
          pos: { x: 100, z: 100 },
          facing: 0 as const,
        },
      ],
    };
    const next = applyPresetSetup(crowded, preset());
    const you = next.setup.participants[0].id;
    expect(next.actors.at(-1)?.team).toBe(you);
  });

  it("copies the preset rather than sharing it", () => {
    const incoming = preset();
    const next = applyPresetSetup(populated(), incoming);
    expect(next.setup.participants).not.toBe(incoming.participants);
    expect(next.setup.participants[0]).toEqual(incoming.participants[0]);
  });
});
