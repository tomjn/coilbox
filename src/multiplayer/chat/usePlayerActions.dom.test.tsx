// @vitest-environment happy-dom

/**
 * The friend, follow and ignore entries every player list's menu offers.
 *
 * The store, the settings and the wire are stood in for, so nothing leaves the
 * test.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const SERVER = "me@example.org:8200";

const { sent, wire } = vi.hoisted(() => {
  const sent: string[] = [];
  const wire = (verb: string) =>
    vi.fn(async ({ username }: { username: string }) => {
      sent.push(`${verb} ${username}`);
    });
  return { sent, wire };
});

vi.mock("../bindings", () => ({
  mpFriendRequest: wire("request"),
  mpAcceptFriendRequest: wire("accept"),
  mpUnfriend: wire("unfriend"),
  mpIgnore: wire("ignore"),
  mpUnignore: wire("unignore"),
}));

const connection = {
  direct: false,
  mirror: {
    state: {
      myUsername: "me",
      friends: [] as string[],
      friendRequests: [] as string[],
    },
  },
};

vi.mock("../store", () => ({
  useConnection: () => connection,
}));

const settings: Record<string, unknown> = {};

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => [
    key in settings ? settings[key] : initial,
    (next: unknown) => {
      settings[key] = next;
    },
  ],
}));

import { getFollow, setFollow } from "../follow/followStore";
import { FAVOURITES_KEY } from "../friends";
import { usePlayerActions } from "./usePlayerActions";

const actionsFor = (name: string) =>
  renderHook(() => usePlayerActions(SERVER)).result.current(name);

beforeEach(() => {
  sent.length = 0;
  for (const key of Object.keys(settings)) delete settings[key];
  connection.direct = false;
  connection.mirror.state.friends = [];
  connection.mirror.state.friendRequests = [];
  setFollow(null);
});

it("stars a new friend and asks the server", () => {
  const { friend, follow } = actionsFor("bob");
  expect(friend?.isFriend).toBe(false);
  expect(follow).toBeUndefined();
  friend?.onToggle();
  expect(settings[FAVOURITES_KEY]).toEqual({ [SERVER]: ["bob"] });
  expect(sent).toEqual(["request bob"]);
});

it("accepts somebody who has already asked", () => {
  connection.mirror.state.friendRequests = ["bob"];
  actionsFor("bob").friend?.onToggle();
  expect(sent).toEqual(["accept bob"]);
});

it("removes a server friend, and stops following them", () => {
  connection.mirror.state.friends = ["bob"];
  setFollow({ serverKey: SERVER, name: "bob" });
  const { friend, follow } = actionsFor("bob");
  expect(friend?.isFriend).toBe(true);
  expect(follow?.following).toBe(true);
  friend?.onToggle();
  expect(sent).toEqual(["unfriend bob"]);
  expect(getFollow()).toBeNull();
});

it("unstars a friend the server does not know, without asking it", () => {
  settings[FAVOURITES_KEY] = { [SERVER]: ["bob"] };
  actionsFor("bob").friend?.onToggle();
  expect(settings[FAVOURITES_KEY]).toEqual({ [SERVER]: [] });
  expect(sent).toEqual([]);
});

it("offers no friend or follow on our own row", () => {
  const { friend, follow, ignore } = actionsFor("me");
  expect(friend).toBeUndefined();
  expect(follow).toBeUndefined();
  expect(ignore.ignored).toBe(false);
});

it("offers no friend in a room, which has no accounts", () => {
  connection.direct = true;
  expect(actionsFor("bob").friend).toBeUndefined();
});
