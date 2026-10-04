import { describe, expect, it } from "vitest";
import { FOG_RANGE, withinJumps } from "../fog";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "../model";
import { NEUTRAL } from "../model";
import { attackableNodes } from "../rules";
import { type MapCueInput, mapCues } from "./mapCues";
import { roadLinks } from "./roads";

const outline: [number, number][][] = [
  [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
];

const province = (id: string, owner: string) =>
  ({ id, owner, outline }) as unknown as GalaxyNode;
const city = (id: string, owner: string) =>
  ({ id, owner }) as unknown as GalaxyNode;

/**
 * Home and north are the player's provinces. East is an enemy province across
 * a border, isle an enemy province across a crossing, far a neutral province
 * behind east, and wall touches home behind a blocked border. Port is the
 * player's city, joined to home and to an enemy fort.
 */
const galaxy = {
  nodes: [
    province("home", "red"),
    province("north", "red"),
    province("east", "blue"),
    province("isle", "blue"),
    province("far", NEUTRAL),
    province("wall", "blue"),
    city("port", "red"),
    city("fort", "blue"),
  ],
  links: [
    ["home", "north"],
    ["home", "east"],
    ["home", "isle"],
    ["east", "far"],
    ["far", "wall"],
    ["home", "port"],
    ["port", "fort"],
  ],
  linkKinds: [
    ["home", "east", "border"],
    ["isle", "home", "crossing"],
  ],
  blockedBorders: [["home", "wall"]],
} as unknown as GalaxyDoc;

const owners = Object.fromEntries(galaxy.nodes.map((n) => [n.id, n.owner]));

const conquest = (extra: Partial<MapCueInput> = {}) =>
  mapCues({
    galaxy,
    owners,
    playerFactionId: "red",
    attackable: new Set(
      attackableNodes(galaxy, {
        owners,
        playerFactionId: "red",
      } as ConquestState).map((n) => n.id),
    ),
    ...extra,
  });

const link = (cues: ReturnType<typeof mapCues>, a: string, b: string) => {
  const found = cues.links.find((l) => l.a === a && l.b === b);
  if (!found) throw new Error(`no link ${a} ${b}`);
  return found;
};

const where = (
  cues: ReturnType<typeof mapCues>,
  key: "attackable" | "emphasised" | "threatened" | "hidden",
) =>
  [...cues.locations]
    .filter(([, cue]) => cue[key])
    .map(([id]) => id)
    .sort();

describe("mapCues link kinds", () => {
  it("sorts every link into a road, a crossing or a border", () => {
    const cues = conquest();
    expect(cues.links.map((l) => `${l.a} ${l.b} ${l.kind}`)).toEqual([
      "home north border",
      "home east border",
      "home isle crossing",
      "east far border",
      "far wall border",
      "home port road",
      "port fort road",
    ]);
  });

  it("calls a road exactly what the city layer draws as one", () => {
    const roads = conquest()
      .links.filter((l) => l.kind === "road")
      .map((l) => [l.a, l.b]);
    expect(roads).toEqual(roadLinks(galaxy).map((r) => [r.a, r.b]));
  });

  it("leaves out a link to a location the map does not have", () => {
    const cues = mapCues({
      galaxy: { ...galaxy, links: [["home", "ghost"]] },
      owners,
      playerFactionId: "red",
    });
    expect(cues.links).toEqual([]);
  });
});

describe("mapCues on a conquest", () => {
  it("marks what attackableNodes returns, across a crossing too", () => {
    expect(where(conquest(), "attackable")).toEqual(["east", "fort", "isle"]);
  });

  it("does not mark a province behind a blocked border", () => {
    const cues = conquest();
    expect(cues.locations.get("wall")?.attackable).toBe(false);
    expect(cues.blocked).toEqual([{ a: "home", b: "wall", hidden: false }]);
  });

  it("marks nothing attackable when no set is given", () => {
    const cues = mapCues({ galaxy, owners, playerFactionId: "red" });
    expect(where(cues, "attackable")).toEqual([]);
  });

  it("calls a link with exactly one player end contested", () => {
    const cues = conquest();
    expect(link(cues, "home", "east").tone).toBe("contested");
    expect(link(cues, "home", "isle").tone).toBe("contested");
    expect(link(cues, "port", "fort").tone).toBe("contested");
    expect(link(cues, "east", "far").tone).toBe("plain");
    expect(link(cues, "far", "wall").tone).toBe("plain");
  });

  it("calls a link owned when one faction holds both ends", () => {
    const cues = conquest();
    expect(link(cues, "home", "north")).toMatchObject({
      tone: "owned",
      owner: "red",
    });
    expect(link(cues, "home", "port").tone).toBe("owned");
  });

  it("follows a capture without a new document", () => {
    const cues = conquest({ owners: { ...owners, east: "red" } });
    expect(link(cues, "home", "east").tone).toBe("owned");
    expect(link(cues, "east", "far").tone).toBe("contested");
  });

  it("marks the location under incursion", () => {
    expect(where(conquest(), "threatened")).toEqual([]);
    expect(where(conquest({ incursionNodeId: "north" }), "threatened")).toEqual(
      ["north"],
    );
  });

  it("emphasises the selected location's neighbours and its links", () => {
    const cues = conquest({ selectedId: "home" });
    // Wall touches home but is not a neighbour.
    expect(where(cues, "emphasised")).toEqual([
      "east",
      "isle",
      "north",
      "port",
    ]);
    expect(link(cues, "home", "isle").emphasised).toBe(true);
    expect(link(cues, "east", "far").emphasised).toBe(false);
  });

  it("emphasises from either end of a link", () => {
    expect(where(conquest({ selectedId: "isle" }), "emphasised")).toEqual([
      "home",
    ]);
  });
});

describe("mapCues under fog of war", () => {
  // What fog.ts reveals for this map: everything within two links of the
  // player's home, north and port. That leaves wall hidden.
  const visible = withinJumps(galaxy, ["home", "north", "port"], FOG_RANGE);

  it("hides nothing when there is no fog", () => {
    expect(where(conquest(), "hidden")).toEqual([]);
    expect(conquest().links.some((l) => l.hidden)).toBe(false);
  });

  it("hides exactly the locations the fog rule does not reveal", () => {
    expect(where(conquest({ visible }), "hidden")).toEqual(["wall"]);
  });

  it("gives a hidden location no other state", () => {
    const cues = conquest({
      visible: new Set(["home", "north", "port"]),
      attackable: new Set(["east", "isle", "fort"]),
      incursionNodeId: "east",
      selectedId: "home",
    });
    for (const id of ["east", "isle", "fort", "far", "wall"]) {
      expect(cues.locations.get(id)).toEqual({
        attackable: false,
        emphasised: false,
        threatened: false,
        hidden: true,
      });
    }
    // Neighbours the player can see are still emphasised.
    expect(where(cues, "emphasised")).toEqual(["north", "port"]);
  });

  it("draws a link with one hidden end plain, whoever holds that end", () => {
    const cues = conquest({
      visible: new Set(["home", "north", "port"]),
      selectedId: "home",
    });
    for (const [a, b] of [
      ["home", "east"],
      ["home", "isle"],
      ["port", "fort"],
    ]) {
      expect(link(cues, a, b)).toMatchObject({
        tone: "plain",
        emphasised: false,
        hidden: false,
      });
    }
    expect(link(cues, "home", "north").tone).toBe("owned");
  });

  it("does not draw a link or a blocked border between two hidden locations", () => {
    const cues = conquest({ visible: new Set(["home", "north", "port"]) });
    expect(link(cues, "east", "far").hidden).toBe(true);
    expect(link(cues, "far", "wall").hidden).toBe(true);
    // Home is visible, so its blocked border onto wall still draws.
    expect(cues.blocked).toEqual([{ a: "home", b: "wall", hidden: false }]);
    const dark = conquest({ visible: new Set(["north"]) });
    expect(dark.blocked).toEqual([{ a: "home", b: "wall", hidden: true }]);
  });

  it("restores every cue when a location is revealed", () => {
    const fogged = conquest({ visible: new Set(["home", "north", "port"]) });
    expect(fogged.locations.get("east")?.attackable).toBe(false);
    const revealed = conquest({ visible });
    expect(revealed.locations.get("east")).toMatchObject({
      attackable: true,
      hidden: false,
    });
    expect(link(revealed, "home", "east").tone).toBe("contested");
    expect(link(revealed, "east", "far").hidden).toBe(false);
  });

  it("offers no step into a hidden location on a run", () => {
    const cues = mapCues({
      galaxy,
      owners,
      playerFactionId: "red",
      run: {},
      visible: new Set(["home", "north", "port", "isle"]),
    });
    expect(link(cues, "home", "east").tone).toBe("plain");
    expect(link(cues, "home", "isle").tone).toBe("choice");
    expect(where(cues, "attackable")).toEqual(["isle"]);
  });
});

describe("mapCues on a Warpath run", () => {
  // The player started at north, moved to home and stands there.
  const runOwners = {
    ...owners,
    north: "taken",
    home: "red",
    port: "blue",
  };
  const run = (extra: Partial<MapCueInput> = {}) =>
    mapCues({
      galaxy: {
        ...galaxy,
        links: [["north", "home"], ...galaxy.links.slice(1)],
      },
      owners: runOwners,
      playerFactionId: "red",
      run: { pathLinks: new Set(["north home"]) },
      ...extra,
    });

  it("marks the steps already made", () => {
    expect(link(run(), "north", "home").tone).toBe("taken");
  });

  it("marks the steps open from the current location, and where they lead", () => {
    const cues = run();
    expect(link(cues, "home", "east").tone).toBe("choice");
    expect(link(cues, "home", "isle").tone).toBe("choice");
    expect(link(cues, "home", "port").tone).toBe("choice");
    expect(where(cues, "attackable")).toEqual(["east", "isle", "port"]);
  });

  it("does not offer a step that runs into the current location", () => {
    const cues = mapCues({
      galaxy,
      owners: { ...owners, home: "blue", north: "red", port: "blue" },
      playerFactionId: "red",
      run: {},
    });
    // The link is stored home to north, so it leads away from north.
    expect(link(cues, "home", "north").tone).toBe("plain");
    expect(where(cues, "attackable")).toEqual([]);
  });

  it("has no contested or owned links, and ignores the conquest set", () => {
    const cues = run({ attackable: new Set(["far"]) });
    expect(cues.links.map((l) => l.tone)).not.toContain("contested");
    expect(cues.links.map((l) => l.tone)).not.toContain("owned");
    expect(cues.locations.get("far")?.attackable).toBe(false);
  });
});
