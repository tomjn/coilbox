// @vitest-environment happy-dom

/**
 * The top bar's follow indicator, and the follow it runs (issue #3696).
 *
 * What to do at each step is `followStep`'s and has its own tests. This covers
 * the part around it: that the answer is carried out once against the friend's
 * own connection, that a landed join opens the battle room, and that the
 * indicator is there only while somebody is followed.
 *
 * The connection is stood in for, so a test can say what the server shows next
 * and draw again. The popover is stood in for so its contents are always drawn.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  connection: null as unknown,
  favourites: {} as Record<string, string[]>,
  joinBattle: vi.fn(),
  leaveBattle: vi.fn(async () => ({})),
  notify: vi.fn(async () => {}),
  navigate: vi.fn(),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("react-router", () => ({ useNavigate: () => world.navigate }));
vi.mock("../../notify/notify", () => ({ notify: world.notify }));
vi.mock("../battle/leaveBattle", () => ({ leaveBattle: world.leaveBattle }));
vi.mock("../battles/joinBattle", () => ({ joinBattle: world.joinBattle }));
vi.mock("../battles/oneBattle", () => ({
  useOneBattleRule: () => ({ leaveOther: async () => {}, notice: () => null }),
}));
vi.mock("../chat/FriendBattleButton", () => ({
  FriendBattleButton: () => null,
}));
vi.mock("../friends", () => ({
  useFavourites: () => [world.favourites, () => {}],
}));
vi.mock("../store", () => ({
  useConnection: (key: string | null | undefined) =>
    key ? world.connection : null,
  useMultiplayer: () => ({ busy: false, clearJoinError: () => {} }),
  useProtocolServers: () => [],
  serverNameFor: () => "Test server",
  usernameFromKey: () => "me",
}));

import FollowIndicator from "./FollowIndicator";
import { getFollow, setFollow } from "./followStore";

const KEY = "me@test:8200";

function battle(id: number, members: string[] = []) {
  return {
    id,
    tachyonId: null,
    host: `host${id}`,
    title: `Battle ${id}`,
    passworded: false,
    locked: false,
    inProgress: false,
    maxPlayers: 8,
    playerCount: null,
    members: Object.fromEntries(members.map((m) => [m, {}])),
  };
}

/** What the friend's server shows: the battles, and the one we are in. */
function show(
  battles: ReturnType<typeof battle>[],
  currentBattle: number | null = null,
  over: { friends?: string[]; lastJoinError?: string } = {},
) {
  world.connection = {
    live: true,
    mirror: {
      phase: "ready",
      lastJoinError: over.lastJoinError ?? null,
      state: {
        myUsername: "me",
        users: { me: { status: { ingame: false } } },
        friends: over.friends ?? ["amy"],
        battles: Object.fromEntries(battles.map((b) => [String(b.id), b])),
        currentBattle,
      },
    },
  };
}

let redraw: () => void;

function mount() {
  const view = render(<FollowIndicator />);
  redraw = () => view.rerender(<FollowIndicator />);
}

/** The server shows something new, and the indicator is drawn against it. */
async function next(...args: Parameters<typeof show>) {
  show(...args);
  await act(async () => redraw());
}

beforeEach(() => {
  world.favourites = {};
  world.joinBattle.mockReset();
  world.leaveBattle.mockClear();
  world.notify.mockClear();
  world.navigate.mockReset();
  show([]);
});

afterEach(() => {
  cleanup();
  act(() => setFollow(null));
});

it("draws nothing while nobody is followed", () => {
  mount();
  expect(screen.queryByText(/Following/)).toBeNull();
});

it("names the friend and stops on Unfollow", () => {
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  expect(screen.getByRole("button", { name: "Following amy" })).toBeTruthy();
  expect(screen.getByText("Not in a battle")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Unfollow" }));
  expect(getFollow()).toBeNull();
  expect(screen.queryByText(/Following/)).toBeNull();
});

it("joins the friend's battle once, on their connection", async () => {
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([battle(5, ["amy"])]);
  await next([battle(5, ["amy", "bob"])]);

  expect(world.joinBattle).toHaveBeenCalledTimes(1);
  expect(world.joinBattle.mock.calls[0][0]).toMatchObject({
    serverKey: KEY,
    battle: { id: 5 },
  });
  expect(screen.getByText("In Battle 5")).toBeTruthy();
});

it("joins a battle the friend hosts, as it does one they join", async () => {
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([{ ...battle(5), host: "amy" }]);

  expect(world.joinBattle).toHaveBeenCalledTimes(1);
  expect(world.joinBattle.mock.calls[0][0]).toMatchObject({
    battle: { id: 5 },
  });
});

it("says it cannot follow into a passworded battle, and names the battle", async () => {
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([{ ...battle(5, ["amy"]), passworded: true }]);

  expect(world.joinBattle).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Cannot follow amy" }),
  ).toBeTruthy();
  expect(screen.getByText("In Battle 5")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/has a password/);
  // Still following: the password can be entered, or the friend may move on.
  expect(getFollow()).not.toBeNull();
});

it("goes back to Following once the player is in the battle", async () => {
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([{ ...battle(5, ["amy"]), passworded: true }]);
  await next([{ ...battle(5, ["amy", "me"]), passworded: true }], 5);

  expect(screen.getByRole("button", { name: "Following amy" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("joins a friend who is already in a game, as a join and nothing more", async () => {
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([{ ...battle(5, ["amy"]), inProgress: true, maxPlayers: 1 }]);

  // The one thing sent is the battle list's own join, which starts no engine.
  expect(world.joinBattle).toHaveBeenCalledTimes(1);
  expect(Object.keys(world.joinBattle.mock.calls[0][0]).sort()).toEqual([
    "awaitLanding",
    "battle",
    "giveUp",
    "leaveOther",
    "serverKey",
  ]);
});

it("opens the battle room when the join lands", async () => {
  world.joinBattle.mockImplementation(
    async (args: { awaitLanding: () => void }) => args.awaitLanding(),
  );
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([battle(5, ["amy"])]);
  expect(world.navigate).not.toHaveBeenCalled();

  await next([battle(5, ["amy", "me"])], 5);
  expect(world.navigate).toHaveBeenCalledTimes(1);
});

it("says why when the server refuses the join", async () => {
  world.joinBattle.mockImplementation(
    async (args: { awaitLanding: () => void }) => args.awaitLanding(),
  );
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([battle(5, ["amy"])]);
  await next([battle(5, ["amy"])], null, { lastJoinError: "You are banned" });

  expect(world.notify).toHaveBeenCalledWith(
    expect.objectContaining({ body: "You are banned", level: "error" }),
  );
  expect(world.navigate).not.toHaveBeenCalled();
});

it("leaves once when the friend leaves the battle they shared", async () => {
  show([battle(5, ["amy", "me"])], 5);
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([battle(5, ["me"])], 5);
  await next([battle(5, ["me", "bob"])], 5);

  expect(world.leaveBattle).toHaveBeenCalledTimes(1);
  expect(world.leaveBattle).toHaveBeenCalledWith(KEY);
  expect(getFollow()).not.toBeNull();
});

it("stops and says so when the friend is removed", async () => {
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([], null, { friends: [] });

  expect(getFollow()).toBeNull();
  expect(world.notify).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Stopped following amy" }),
  );
});

it("follows a friend who is only starred locally", async () => {
  world.favourites = { [KEY]: ["amy"] };
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([battle(5, ["amy"])], null, { friends: [] });

  expect(getFollow()).not.toBeNull();
  expect(world.joinBattle).toHaveBeenCalledTimes(1);
});

it("starts again for a second friend instead of reusing the first's memory", async () => {
  mount();
  act(() => setFollow({ serverKey: KEY, name: "amy" }));
  await next([battle(5, ["amy"]), battle(6, ["bob"])], null, {
    friends: ["amy", "bob"],
  });
  act(() => setFollow({ serverKey: KEY, name: "bob" }));

  expect(world.joinBattle.mock.calls.map((c) => c[0].battle.id)).toEqual([
    5, 6,
  ]);
});
