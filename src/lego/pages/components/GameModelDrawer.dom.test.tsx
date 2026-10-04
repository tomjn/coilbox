// @vitest-environment happy-dom
/**
 * A scan whose unitsync Init failed has not said what is installed (issue
 * #3423), so the game list must show the failure and not say no games are
 * installed.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameList } from "./GameModelDrawer";

afterEach(cleanup);

describe("GameList", () => {
  it("shows the failure and not an empty install when the scan failed", () => {
    render(
      <GameList
        games={[]}
        loading={false}
        error="no space left on device"
        onPick={() => {}}
      />,
    );
    expect(screen.getByText(/no space left on device/)).toBeTruthy();
    expect(screen.queryByText(/No games are installed/)).toBeNull();
  });

  it("still says no games are installed when the scan answered empty", () => {
    render(
      <GameList games={[]} loading={false} error={null} onPick={() => {}} />,
    );
    expect(screen.getByText(/No games are installed/)).toBeTruthy();
  });
});
