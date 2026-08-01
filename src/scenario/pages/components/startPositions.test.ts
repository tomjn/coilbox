import { describe, expect, it } from "vitest";

import type { SkirmishDraft } from "@/play/drafts";
import type { Participant } from "@/play/participants";
import { markerLabel, startMarkers } from "./startPositions";

function participant(over: Partial<Participant> & { id: string }): Participant {
  return {
    kind: "ai",
    name: over.id,
    side: "",
    color: [1, 0, 0],
    allyTeam: 0,
    spectator: false,
    ...over,
  };
}

function draft(over: Partial<SkirmishDraft> = {}): SkirmishDraft {
  return {
    participants: [],
    gameName: "Test Game",
    mapName: "Test Map",
    startPosType: 0,
    modOptionValues: {},
    ...over,
  };
}

const POSITIONS = [
  { x: 100, z: 200 },
  { x: 900, z: 800 },
  { x: 1500, z: 300 },
];

describe("startMarkers", () => {
  it("draws every position the map has, numbered from zero", () => {
    const markers = startMarkers(POSITIONS, draft());
    expect(markers.map((m) => m.index)).toEqual([0, 1, 2]);
    expect(markers.map((m) => m.pos)).toEqual(POSITIONS);
  });

  it("has no positions to draw when the map reports none", () => {
    expect(startMarkers([], draft())).toEqual([]);
  });

  it("puts each participant on the position its compacted team index names", () => {
    const markers = startMarkers(
      POSITIONS,
      draft({
        participants: [
          participant({ id: "a", name: "You", kind: "you", color: [1, 0, 0] }),
          participant({ id: "b", name: "Enemy", color: [0, 0, 1] }),
        ],
      }),
    );
    expect(markers[0].spawn).toEqual({ name: "You", colorHex: "#ff0000" });
    expect(markers[1].spawn).toEqual({ name: "Enemy", colorHex: "#0000ff" });
    // More positions than teams is ordinary, and the spare is still drawn.
    expect(markers[2].spawn).toBeNull();
  });

  it("follows a chosen slot rather than row order", () => {
    const markers = startMarkers(
      POSITIONS,
      draft({
        participants: [
          participant({ id: "a", name: "You", kind: "you", team: 2 }),
          participant({ id: "b", name: "Enemy", team: 0 }),
        ],
      }),
    );
    // Slots 0 and 2 compact to 0 and 1, so the enemy takes the first position.
    expect(markers[0].spawn?.name).toBe("Enemy");
    expect(markers[1].spawn?.name).toBe("You");
    expect(markers[2].spawn).toBeNull();
  });

  it("names one participant for a slot two of them share", () => {
    const markers = startMarkers(
      POSITIONS,
      draft({
        participants: [
          participant({ id: "a", name: "You", kind: "you", team: 0 }),
          participant({ id: "b", name: "Helper", team: 0 }),
          participant({ id: "c", name: "Enemy", team: 1 }),
        ],
      }),
    );
    expect(markers[0].spawn?.name).toBe("You");
    expect(markers[1].spawn?.name).toBe("Enemy");
  });

  it("skips a spectating player, who spawns nowhere", () => {
    const markers = startMarkers(
      POSITIONS,
      draft({
        participants: [
          participant({ id: "a", name: "You", kind: "you", spectator: true }),
          participant({ id: "b", name: "Enemy" }),
        ],
      }),
    );
    expect(markers[0].spawn?.name).toBe("Enemy");
    expect(markers[1].spawn).toBeNull();
  });

  it("claims nothing when the spawn is not the map's to decide", () => {
    for (const startPosType of [1, 2, 3]) {
      const markers = startMarkers(
        POSITIONS,
        draft({
          startPosType,
          participants: [participant({ id: "a", name: "You", kind: "you" })],
        }),
      );
      expect(markers.every((m) => m.spawn === null)).toBe(true);
    }
  });
});

describe("markerLabel", () => {
  it("counts from one, the way the launcher's markers do", () => {
    expect(markerLabel({ index: 0, pos: { x: 0, z: 0 }, spawn: null })).toBe(
      "1",
    );
  });

  it("names whoever spawns there", () => {
    expect(
      markerLabel({
        index: 2,
        pos: { x: 0, z: 0 },
        spawn: { name: "Enemy", colorHex: "#0000ff" },
      }),
    ).toBe("3 · Enemy");
  });
});
