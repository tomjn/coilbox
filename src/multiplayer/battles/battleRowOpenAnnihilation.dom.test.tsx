// @vitest-environment happy-dom

/**
 * The row of an Open Annihilation battle, which is all the player sees of it
 * since it has no room page (issue #4972).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";

const mocks = vi.hoisted(() => ({
  program: null as unknown,
  openUrl: vi.fn(),
}));
vi.mock("../openAnnihilation", () => ({
  useOpenAnnihilation: () => [mocks.program],
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("./BattleRowMapThumb", () => ({ BattleRowMapThumb: () => null }));

import { BattleRow } from "./BattleRow";

const oa = {
  id: 5,
  host: "Host",
  title: "[OA] Skirmish",
  map: "Host chooses in OA",
  modname: "Total Annihilation",
  engine: "Open Annihilation",
  maxPlayers: 8,
  spectatorCount: 0,
  passworded: false,
  locked: false,
  members: {},
  bots: {},
  playerCount: 1,
} as unknown as Battle;

const onJoin = vi.fn();
const onLeave = vi.fn();
const onOpen = vi.fn();

function row(
  battle: Battle,
  over: { joined?: boolean; waitingForHost?: boolean } = {},
) {
  render(
    <ul>
      <BattleRow
        battle={battle}
        joined={false}
        canJoin={true}
        onJoin={onJoin}
        onLeave={onLeave}
        onOpen={onOpen}
        {...over}
      />
    </ul>,
  );
}

beforeEach(() => {
  mocks.program = { path: "/oa/open-annihilation", version: "OA 0.8.10" };
  mocks.openUrl.mockReset().mockResolvedValue(undefined);
  onJoin.mockReset();
  onLeave.mockReset();
  onOpen.mockReset();
});
afterEach(cleanup);

describe("a player with no Open Annihilation", () => {
  beforeEach(() => {
    mocks.program = null;
  });

  it("gets a link to Core Prime in place of Join, and does not join", () => {
    row(oa);
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Get Open Annihilation" }),
    );
    expect(mocks.openUrl).toHaveBeenCalledWith("https://play.coreprime.net");
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("cannot join by clicking the title", () => {
    row(oa);
    expect(screen.queryByRole("button", { name: /Skirmish/ })).toBeNull();
  });

  it("gets the link on a passworded battle too, with no password box", () => {
    row({ ...oa, passworded: true });
    expect(
      screen.getByRole("button", { name: "Get Open Annihilation" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
  });

  it("still sees Join on a Recoil battle", () => {
    row({ ...oa, engine: "spring" });
    expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Get Open Annihilation" }),
    ).toBeNull();
  });
});

describe("a player with Open Annihilation", () => {
  it("joins from the row", () => {
    row(oa);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onJoin).toHaveBeenCalledOnce();
  });

  it("has Leave on the joined row, and a title that opens no room", () => {
    row(oa, { joined: true });
    fireEvent.click(screen.getByRole("button", { name: "Leave battle" }));
    expect(onLeave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
  });

  it("says when it waits for the host", () => {
    row(oa, { joined: true, waitingForHost: true });
    expect(screen.getByText("Waiting for host")).toBeTruthy();
  });

  it("does not say so otherwise", () => {
    row(oa, { joined: true });
    expect(screen.queryByText("Waiting for host")).toBeNull();
  });
});

describe("a Recoil battle", () => {
  it("keeps a joined title that opens its room", () => {
    row({ ...oa, engine: "spring" }, { joined: true });
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
