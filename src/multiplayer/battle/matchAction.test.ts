import { describe, expect, it } from "vitest";
import {
  type AutoLaunchState,
  launchesOnItsOwn,
  type MatchState,
  matchAction,
} from "./matchAction";

function state(p: Partial<MatchState> = {}): MatchState {
  return {
    selfHost: false,
    hostIngame: true,
    presentAtStart: true,
    launching: false,
    running: false,
    ...p,
  };
}

describe("matchAction", () => {
  it("offers the start while no match is running", () => {
    expect(matchAction(state({ hostIngame: false }))).toBe("start");
  });

  it("offers a rejoin once our engine exits mid-match", () => {
    expect(matchAction(state())).toBe("rejoin");
  });

  it("offers a watch to somebody who walked into a running room", () => {
    expect(matchAction(state({ presentAtStart: false }))).toBe("watch");
  });

  it("offers nothing while our engine is running", () => {
    expect(matchAction(state({ running: true }))).toBe("ingame");
    expect(matchAction(state({ running: true, presentAtStart: false }))).toBe(
      "ingame",
    );
  });

  it("offers nothing while our launch is still on its way", () => {
    expect(matchAction(state({ launching: true }))).toBe("ingame");
    expect(matchAction(state({ launching: true, presentAtStart: false }))).toBe(
      "ingame",
    );
  });

  it("offers nothing while the match we host is running", () => {
    expect(matchAction(state({ selfHost: true, running: true }))).toBe(
      "ingame",
    );
    expect(matchAction(state({ selfHost: true, launching: true }))).toBe(
      "ingame",
    );
  });

  it("offers Start when our in-game flag has no engine behind it", () => {
    expect(matchAction(state({ selfHost: true }))).toBe("start");
  });
});

function auto(p: Partial<AutoLaunchState> = {}): AutoLaunchState {
  return {
    selfHost: false,
    hostIngame: true,
    presentAtStart: true,
    launched: false,
    canRun: true,
    serverSendsMatch: false,
    ...p,
  };
}

describe("launchesOnItsOwn", () => {
  it("launches for somebody who was in the room when the match started", () => {
    expect(launchesOnItsOwn(auto())).toBe(true);
  });

  it("leaves somebody who walked into a running room where they are", () => {
    expect(launchesOnItsOwn(auto({ presentAtStart: false }))).toBe(false);
  });

  it("launches once for a match, so an engine that exits stays exited", () => {
    expect(launchesOnItsOwn(auto({ launched: true }))).toBe(false);
  });

  it("does nothing while no match is running", () => {
    expect(launchesOnItsOwn(auto({ hostIngame: false }))).toBe(false);
  });

  it("does nothing when we host, where Start is the launch", () => {
    expect(launchesOnItsOwn(auto({ selfHost: true }))).toBe(false);
  });

  it("waits for a map or game we do not have yet", () => {
    expect(launchesOnItsOwn(auto({ canRun: false }))).toBe(false);
  });

  // Zero-K's match running and its ConnectSpring both arrive, and only the
  // second says where the match is. Launching off both starts two engines.
  it("leaves the launch to the server's message where the server sends one", () => {
    expect(launchesOnItsOwn(auto({ serverSendsMatch: true }))).toBe(false);
  });
});
