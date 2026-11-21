import { describe, expect, it } from "vitest";
import type { DemoInfo, StartBoxConfig } from "./bindings";
import {
  NEUTRAL_AREA_COLOUR,
  rectangleAreas,
  replayRoom,
  zerokAreas,
} from "./replayStartAreas";

const EXTENT = { x: 8192, z: 4096 };

const square = (x: number, z: number, size = 1000): [number, number][] => [
  [x, z],
  [x + size, z],
  [x + size, z + size],
  [x, z + size],
];

/** Three areas: the west, the middle and the east. */
const CONFIG: StartBoxConfig = {
  source: "game",
  file: "LuaRules/Configs/StartBoxes/Map.lua",
  teams: [
    { id: 0, startPoints: [], boxes: [square(500, 500)] },
    { id: 1, startPoints: [], boxes: [square(3500, 500)] },
    { id: 2, startPoints: [], boxes: [square(6500, 500)] },
  ],
};

function replay(over: Partial<DemoInfo> = {}): DemoInfo {
  return {
    engineVersion: "105",
    startTimeMs: 0,
    durationSec: 600,
    wallclockSec: 600,
    mapName: "Map",
    gameType: "Zero-K v1.12",
    winningAllyTeams: [],
    winnersKnown: false,
    numAllyTeams: 2,
    allyTeams: [
      { id: 0, color: [1, 0, 0] },
      { id: 1, color: [0, 0, 1] },
    ],
    players: [
      { name: "Alice", team: 0, allyTeam: 0, spectator: false },
      { name: "Bob", team: 1, allyTeam: 1, spectator: false },
    ],
    ais: [],
    modOptions: {},
    mapOptions: {},
    ...over,
  } as DemoInfo;
}

describe("zerokAreas", () => {
  it("gives an area the colour and number of the side that started in it", () => {
    // Zero-K shuffled the boxes: side 1 (Alice) started in the east area and
    // side 2 (Bob) in the west one.
    const { areas, extent } = zerokAreas(
      CONFIG,
      replay({
        startPositions: [
          { team: 0, x: 7000, y: 0, z: 1000 },
          { team: 1, x: 1000, y: 0, z: 1000 },
        ],
      }),
      EXTENT,
    );
    expect(extent).toBe(EXTENT);
    expect(areas.map((a) => [a.key, a.label, a.color])).toEqual([
      ["0", "2", "#0000ff"],
      ["1", undefined, NEUTRAL_AREA_COLOUR],
      ["2", "1", "#ff0000"],
    ]);
    expect(areas[2].title).toBe("Team 1 start box");
    expect(areas[2].polygons).toEqual([square(6500, 500)]);
  });

  it("draws an area nobody started in with a neutral outline and no number", () => {
    const { areas } = zerokAreas(
      CONFIG,
      replay({ startPositions: [{ team: 0, x: 1000, y: 0, z: 1000 }] }),
      EXTENT,
    );
    const middle = areas[1];
    expect(middle.color).toBe(NEUTRAL_AREA_COLOUR);
    expect(middle.label).toBeUndefined();
    expect(middle.title).toBeUndefined();
  });

  it("draws every area neutral when the replay recorded no start positions", () => {
    const { areas } = zerokAreas(CONFIG, replay(), EXTENT);
    expect(areas.map((a) => a.color)).toEqual([
      NEUTRAL_AREA_COLOUR,
      NEUTRAL_AREA_COLOUR,
      NEUTRAL_AREA_COLOUR,
    ]);
  });

  it("draws an area two sides started in neutral, since it has no one owner", () => {
    const { areas } = zerokAreas(
      CONFIG,
      replay({
        startPositions: [
          { team: 0, x: 1000, y: 0, z: 1000 },
          { team: 1, x: 1200, y: 0, z: 1100 },
        ],
      }),
      EXTENT,
    );
    expect(areas[0].color).toBe(NEUTRAL_AREA_COLOUR);
    expect(areas[0].label).toBeUndefined();
  });

  it("gives an area to a side when several of its players started there", () => {
    const { areas } = zerokAreas(
      CONFIG,
      replay({
        players: [
          { name: "Alice", team: 0, allyTeam: 0, spectator: false },
          { name: "Carol", team: 2, allyTeam: 0, spectator: false },
          { name: "Bob", team: 1, allyTeam: 1, spectator: false },
        ],
        startPositions: [
          { team: 0, x: 1000, y: 0, z: 1000 },
          { team: 2, x: 1300, y: 0, z: 1300 },
          { team: 1, x: 7000, y: 0, z: 1000 },
        ],
      }),
      EXTENT,
    );
    expect(areas.map((a) => a.label)).toEqual(["1", undefined, "2"]);
  });

  it("reads a bot's side from its own entry", () => {
    const { areas } = zerokAreas(
      CONFIG,
      replay({
        players: [{ name: "Alice", team: 0, allyTeam: 0, spectator: false }],
        ais: [
          { name: "AI 1", shortName: "Null", team: 1, allyTeam: 1 },
        ] as DemoInfo["ais"],
        startPositions: [{ team: 1, x: 7000, y: 0, z: 1000 }],
      }),
      EXTENT,
    );
    expect(areas[2].label).toBe("2");
  });

  it("ignores the start position of a team no side is known for", () => {
    const { areas } = zerokAreas(
      CONFIG,
      replay({ startPositions: [{ team: 9, x: 1000, y: 0, z: 1000 }] }),
      EXTENT,
    );
    expect(areas[0].color).toBe(NEUTRAL_AREA_COLOUR);
  });

  it("takes a side from the match setup for a team the player list does not reach", () => {
    const { areas } = zerokAreas(
      CONFIG,
      replay({
        players: [],
        matchSetup: {
          teams: [{ allyTeam: 1 }],
        } as unknown as DemoInfo["matchSetup"],
        startPositions: [{ team: 0, x: 1000, y: 0, z: 1000 }],
      }),
      EXTENT,
    );
    expect(areas[0].label).toBe("2");
  });

  it("counts an area of several polygons as one", () => {
    const config: StartBoxConfig = {
      ...CONFIG,
      teams: [
        {
          id: 0,
          startPoints: [],
          boxes: [square(500, 500), square(3500, 500)],
        },
      ],
    };
    const { areas } = zerokAreas(
      config,
      replay({ startPositions: [{ team: 1, x: 3800, y: 0, z: 800 }] }),
      EXTENT,
    );
    expect(areas).toHaveLength(1);
    expect(areas[0].label).toBe("2");
  });
});

describe("rectangleAreas", () => {
  it("draws a side's rectangle in its colour with its number", () => {
    const { areas, extent } = rectangleAreas(
      replay({
        allyTeams: [
          {
            id: 1,
            color: [0, 0.5, 1],
            startBox: { left: 0.3, top: 0.25, right: 0.5, bottom: 0.5 },
          },
          { id: 0 },
        ],
      }),
    );
    expect(extent).toEqual({ x: 1, z: 1 });
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({
      key: "1",
      label: "2",
      title: "Team 2 start box",
      color: "#0080ff",
      polygons: [
        [
          [0.3, 0.25],
          [0.5, 0.25],
          [0.5, 0.5],
          [0.3, 0.5],
        ],
      ],
    });
  });

  it("draws a side with no colour in the neutral one", () => {
    const { areas } = rectangleAreas(
      replay({
        allyTeams: [
          { id: 0, startBox: { left: 0, top: 0, right: 1, bottom: 1 } },
        ],
      }),
    );
    expect(areas[0].color).toBe(NEUTRAL_AREA_COLOUR);
  });

  it("draws nothing for a match that set none", () => {
    expect(rectangleAreas(replay()).areas).toEqual([]);
  });
});

describe("replayRoom", () => {
  it("is the replay's own sides and players, with no spectators", () => {
    expect(
      replayRoom(
        replay({
          players: [
            { name: "Alice", team: 0, allyTeam: 0, spectator: false },
            { name: "Carol", team: 2, allyTeam: 0, spectator: false },
            { name: "Watcher", spectator: true, allyTeam: 3 },
          ],
          ais: [
            { name: "AI 1", shortName: "Null", team: 1, allyTeam: 1 },
          ] as DemoInfo["ais"],
        }),
      ),
    ).toEqual([
      { allyTeam: 0, bots: [false, false] },
      { allyTeam: 1, bots: [true] },
    ]);
  });
});
