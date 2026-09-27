import { describe, expect, it } from "vitest";
import { startButtonLabel } from "./startButtonLabel";

describe("startButtonLabel", () => {
  it("says Start for a player who can start the match directly", () => {
    expect(startButtonLabel(true)).toBe("Start");
  });

  it("says Vote to start for a player who cannot", () => {
    expect(startButtonLabel(false)).toBe("Vote to start");
  });
});
