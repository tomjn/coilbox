import { describe, expect, it } from "vitest";
import {
  type ConnectionState,
  liveConnectionKeys,
  newConnection,
} from "./connections";

function live(serverKey: string): ConnectionState {
  return { ...newConnection(serverKey), live: true };
}

function dropped(serverKey: string): ConnectionState {
  return { ...newConnection(serverKey), live: false };
}

describe("liveConnectionKeys", () => {
  it("returns nothing when there are no connections", () => {
    expect(liveConnectionKeys({}, null)).toEqual([]);
  });

  it("skips a dropped connection kept only for its error", () => {
    const connections = { a: live("a"), b: dropped("b") };
    expect(liveConnectionKeys(connections, null)).toEqual(["a"]);
  });

  it("puts the focused key first among the live ones", () => {
    const connections = { a: live("a"), b: live("b"), c: live("c") };
    expect(liveConnectionKeys(connections, "b")).toEqual(["b", "a", "c"]);
  });

  it("falls back to insertion order when the focus key is not live", () => {
    const connections = { a: live("a"), b: dropped("b") };
    expect(liveConnectionKeys(connections, "b")).toEqual(["a"]);
  });

  it("falls back to insertion order when there is no focus key", () => {
    const connections = { a: live("a"), b: live("b") };
    expect(liveConnectionKeys(connections, null)).toEqual(["a", "b"]);
  });
});
