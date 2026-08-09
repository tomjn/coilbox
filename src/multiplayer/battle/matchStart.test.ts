import { describe, expect, it } from "vitest";
import { matchStartAction } from "./matchStart";

describe("matchStartAction", () => {
  it("launches when the server names a match the room has not acted on", () => {
    expect(matchStartAction({ seq: 1, actedOn: 0, canRun: true })).toBe(
      "launch",
    );
  });

  it("ignores a counter that has not moved", () => {
    expect(matchStartAction({ seq: 3, actedOn: 3, canRun: true })).toBe(
      "ignore",
    );
  });

  it("ignores a counter that went backwards", () => {
    // A reconnect resets the mirror. Treating that as a new match would point
    // the engine at one that finished hours ago.
    expect(matchStartAction({ seq: 0, actedOn: 4, canRun: true })).toBe(
      "ignore",
    );
  });

  it("waits rather than launching when the content is not there", () => {
    expect(matchStartAction({ seq: 1, actedOn: 0, canRun: false })).toBe(
      "wait",
    );
  });

  it("launches the match it was waiting on once the content lands", () => {
    // The room holds the signal rather than dropping it, because the server has
    // already been told we are coming.
    expect(matchStartAction({ seq: 1, actedOn: 0, canRun: false })).toBe(
      "wait",
    );
    expect(matchStartAction({ seq: 1, actedOn: 0, canRun: true })).toBe(
      "launch",
    );
  });

  it("launches a second match in the same lobby", () => {
    expect(matchStartAction({ seq: 2, actedOn: 1, canRun: true })).toBe(
      "launch",
    );
  });
});
