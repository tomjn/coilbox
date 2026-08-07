import { describe, expect, it } from "vitest";
import { canRejoinMatch, type RejoinState } from "./rejoin";

function state(p: Partial<RejoinState> = {}): RejoinState {
  return {
    selfHost: false,
    hostIngame: true,
    launchSettled: true,
    running: false,
    canRun: true,
    ...p,
  };
}

describe("canRejoinMatch", () => {
  it("offers a rejoin once our engine exits mid-match", () => {
    expect(canRejoinMatch(state())).toBe(true);
  });

  it("stays hidden while our engine is still running", () => {
    expect(canRejoinMatch(state({ running: true }))).toBe(false);
  });

  it("stays hidden before our launch has settled", () => {
    expect(canRejoinMatch(state({ launchSettled: false }))).toBe(false);
  });

  it("stays hidden once the match is over", () => {
    expect(canRejoinMatch(state({ hostIngame: false }))).toBe(false);
  });

  it("stays hidden when we host, where Start is the launch button", () => {
    expect(canRejoinMatch(state({ selfHost: true }))).toBe(false);
  });

  it("stays hidden when the map or game is missing", () => {
    expect(canRejoinMatch(state({ canRun: false }))).toBe(false);
  });
});
