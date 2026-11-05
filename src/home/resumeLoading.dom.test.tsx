// @vitest-environment happy-dom

/**
 * What the resume row waits for before it draws (#5080).
 *
 * The row waited for the hand-made maps games carry, which are listed only once
 * every installed game has been read through unitsync, so on every launch the
 * whole row stayed empty for as long as that took. It now waits for the saved
 * hand-made maps alone, and a conquest on a game's map shows with its title
 * still loading.
 *
 * Every source is stubbed at its hook, so the real `useResume` runs on top.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConquestStateFile } from "../conquest/model";

vi.mock("@picoframe/frame", () => ({
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("../multiplayer/ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("../multiplayer/ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("../multiplayer/chat/mentionCue", () => ({
  triggerMentionCue: () => {},
}));

const done = { loading: false };
vi.mock("../runlite/runs", () => ({ useRuns: () => ({ runs: {}, ...done }) }));
vi.mock("../campaign/campaigns", () => ({
  useCampaigns: () => ({ campaigns: [], ...done }),
  useCampaignProgress: () => ({
    progress: { schemaVersion: 1, campaigns: {} },
    ...done,
  }),
}));
const conquests = vi.fn<() => ConquestStateFile>();
vi.mock("../conquest/conquests", () => ({
  useGalaxies: () => ({ galaxies: [], ...done }),
  useConquestState: () => ({ file: conquests(), ...done }),
}));
const handmade = vi.fn<() => { loading: boolean; savedLoading: boolean }>();
vi.mock("../conquest/handmade/useHandmadeMaps", () => ({
  useHandmadeMaps: () => ({ maps: [], ...handmade() }),
}));
vi.mock("../multiplayer/battle/useBattleRoomKey", () => ({
  useInBattleKey: () => null,
}));
vi.mock("../multiplayer/store", () => ({
  useConnection: () => undefined,
  initialMirror: { state: null },
}));
vi.mock("../updater/UpdaterProvider", () => ({
  useAvailableUpdate: () => ({ update: null, version: null }),
}));

import { useResume } from "./continue";

const ACTIVE: ConquestStateFile = {
  schemaVersion: 1,
  conquests: {
    "two-shores": {
      seed: 1,
      turn: 14,
      playerFactionId: "arm",
      owners: {},
      incursions: [],
      status: "active",
      history: [],
      updatedAt: "2026-11-05T12:00:00Z",
    },
  },
};

beforeEach(() => {
  conquests.mockReturnValue(ACTIVE);
});

describe("what the resume row waits for", () => {
  it("does not wait for the maps games carry", () => {
    handmade.mockReturnValue({ loading: true, savedLoading: false });
    const { result } = renderHook(() => useResume());
    expect(result.current.loading).toBe(false);
    const [conquest] = result.current.candidates;
    expect(conquest.kind).toBe("conquest");
    expect(conquest.titlePending).toBe(true);
    expect(conquest.detail).toBe("Turn 14");
  });

  it("still waits for the saved hand-made maps, which are a folder read", () => {
    handmade.mockReturnValue({ loading: true, savedLoading: true });
    const { result } = renderHook(() => useResume());
    expect(result.current.loading).toBe(true);
  });

  it("drops a conquest whose map is on no list once every game is read", () => {
    handmade.mockReturnValue({ loading: false, savedLoading: false });
    const { result } = renderHook(() => useResume());
    expect(result.current.loading).toBe(false);
    expect(result.current.candidates).toEqual([]);
  });
});
