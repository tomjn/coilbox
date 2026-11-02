// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapItem } from "@/content/bindings";
import { encodeArrangement } from "@/startbox/barBoxes";
import type { Battle } from "../bindings";
import { BattleMapCard } from "./BattleMapCard";
import type { MemberRow } from "./config";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }),
}));
vi.mock("@/content/config", () => ({
  useUnitsyncMapMeta: () => ({ meta: new Map() }),
  useUnitsyncMinimap: () => ({
    url: "minimap.png",
    startPositions: [],
    loading: false,
    env: {},
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
}));
vi.mock("@/hub/assets/useMapPicture", () => ({
  useMapPictureLadder: () => null,
}));
vi.mock("@/hub/maps/useMapFacts", () => ({ useMapFacts: () => null }));
vi.mock("@/startbox/useZerokStartBoxes", () => ({
  useZerokStartBoxes: () => ({ config: null, loading: false }),
}));
vi.mock("./useMapChangeQueue", () => ({
  useMapChangeQueue: () => ({ pendingMap: null, requestMapChange: vi.fn() }),
}));
vi.mock("@/play/pages/components/MapOverlay", () => ({
  MapLayerToggle: () => null,
  MapOverlayImage: () => null,
  useMapOverlayLayer: () => ({
    layer: "none",
    setLayer: vi.fn(),
    overlayUrl: null,
  }),
}));
// The real card brings the picker and the minimap. The overlay is all this
// test reads.
vi.mock("@/play/pages/components/MapCard", () => ({
  MapCard: ({ overlay }: { overlay: ReactNode }) => (
    <div data-testid="map">{overlay}</div>
  ),
}));

afterEach(cleanup);

// 512 by 256 on the scan is 8192 by 4096 in world units.
const MAP: MapItem = {
  name: "Jade Empress 1.41",
  archives: [],
  info: {},
  width: 512,
  height: 256,
};

const row = (name: string, ally: number): MemberRow =>
  ({
    name,
    kind: "human",
    self: false,
    host: false,
    boss: false,
    ready: true,
    sync: 1,
    spectator: false,
    teamId: ally,
    ally,
    side: 0,
    colorHex: "#ffffff",
    handicap: 0,
  }) as MemberRow;

const ROWS = [row("one", 0), row("two", 1)];

const battle = (
  scriptTags: Record<string, string>,
  startRects: Battle["startRects"] = {},
): Battle =>
  ({
    id: 1,
    map: MAP.name,
    scriptTags,
    startRects,
  }) as unknown as Battle;

function draw(b: Battle, extra: { canEditBoxes?: boolean } = {}) {
  return render(
    <BattleMapCard
      battle={b}
      rows={ROWS}
      enginePath="/engine"
      dataDir="/data"
      game={undefined}
      maps={[MAP]}
      mapsLoading={false}
      localMap={MAP}
      mapMissing={false}
      startPosType={2}
      canChangeMap={false}
      canEditBoxes={extra.canEditBoxes ?? false}
      activeAlly={0}
      onSetBox={vi.fn()}
      onClearBox={vi.fn()}
      onSuggestMap={vi.fn()}
      onChangeMap={vi.fn()}
      onRescan={vi.fn()}
    />,
  );
}

const SET_TAG = "game/modoptions/mapmetadata_startboxes_set";
const OVERRIDE_TAG = "game/modoptions/mapmetadata_startbox_override";

/** The two-team entry for Jade Empress, from BAR's map list. */
const JADE = {
  maxPlayersPerStartbox: 8,
  startboxes: [
    {
      poly: [
        { x: 57, y: 26 },
        { x: 98, y: 32 },
        { x: 110, y: 78 },
        { strength: 0.75, x: 52, y: 142 },
        { strength: 1, x: 37, y: 149 },
        { strength: 1, x: 28, y: 123 },
        { strength: 0.475, x: 37, y: 70 },
      ],
    },
    {
      poly: [
        { x: 123, y: 90 },
        { x: 168, y: 93 },
        { strength: 0.875, x: 165, y: 134 },
        { strength: 0.65, x: 150, y: 158 },
        { strength: 0.775, x: 86, y: 175 },
        { strength: 1, x: 56, y: 165 },
        { strength: 0.775, x: 63, y: 152 },
      ],
    },
  ],
};
const SET = Buffer.from(JSON.stringify({ "2": JADE })).toString("base64url");

describe("BattleMapCard start boxes", () => {
  it("draws the curves of a room that carries BAR's set", () => {
    const { container } = draw(battle({ [SET_TAG]: SET }));
    const polygons = container.querySelectorAll("polygon");
    // Two teams, each drawn twice for its hairline and its edge.
    expect(polygons).toHaveLength(4);
    // The first ring has 7 anchors and, from the cuts on its curved edges, 62
    // points in all.
    const points = (polygons[1].getAttribute("points") ?? "").split(" ");
    expect(points).toHaveLength(62);
  });

  it("draws the rectangles the lobby sent when the room has neither option", () => {
    const { container } = draw(
      battle({}, { "0": { left: 0, top: 0, right: 50, bottom: 50 } }),
    );
    expect(container.querySelectorAll("polygon")).toHaveLength(0);
    expect(container.querySelectorAll("div.border-2")).toHaveLength(1);
  });

  it("draws the rectangles when the set cannot be read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = draw(
      battle(
        { [SET_TAG]: "not a start box payload" },
        { "0": { left: 0, top: 0, right: 50, bottom: 50 } },
      ),
    );
    expect(container.querySelectorAll("polygon")).toHaveLength(0);
    expect(container.querySelectorAll("div.border-2")).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(
      "mapmetadata_startboxes_set",
    );
    warn.mockRestore();
  });

  it("draws the override in preference to the set", () => {
    const override = encodeArrangement({
      startboxes: [
        {
          poly: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
        {
          poly: [
            { x: 100, y: 100 },
            { x: 200, y: 200 },
          ],
        },
      ],
    });
    const { container } = draw(
      battle({ [SET_TAG]: SET, [OVERRIDE_TAG]: override }),
    );
    const edge = container.querySelectorAll("polygon")[1];
    expect(edge.getAttribute("points")?.split(" ")).toHaveLength(4);
  });

  it("starts the editor empty over a set, so the lobby's own rectangles do not show", () => {
    const { container } = draw(
      battle(
        { [SET_TAG]: SET },
        { "0": { left: 0, top: 0, right: 50, bottom: 50 } },
      ),
      { canEditBoxes: true },
    );
    expect(container.querySelectorAll("polygon")).toHaveLength(4);
    expect(container.querySelectorAll("div.border-2")).toHaveLength(0);
  });
});
