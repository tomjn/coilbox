// @vitest-environment happy-dom
/**
 * A scan whose unitsync Init failed has not said what is installed (issue
 * #3423), so the setup must show the failure and not say the game or map is
 * missing.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SetupMissing } from "./SetupPanel";

afterEach(cleanup);

const names = { gameName: "Splinter Faction", mapName: "Comet Catcher" };

describe("SetupMissing", () => {
  it("shows the failure and no missing claim when the scan failed", () => {
    render(
      <SetupMissing
        scan={{ loading: false, error: "no space left on device" }}
        {...names}
        hasGame={false}
        hasMap={false}
      />,
    );
    expect(screen.getByText(/no space left on device/)).toBeTruthy();
    expect(screen.queryByText(/is not installed/)).toBeNull();
  });

  it("still names a game the answered scan does not have", () => {
    render(
      <SetupMissing
        scan={{ loading: false, error: null }}
        {...names}
        hasGame={false}
        hasMap
      />,
    );
    expect(screen.getByText(/Splinter Faction is not installed/)).toBeTruthy();
  });
});
