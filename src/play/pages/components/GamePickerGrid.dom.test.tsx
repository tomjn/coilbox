// @vitest-environment happy-dom

/**
 * The game picker's empty states. A failed content scan leaves the list empty
 * because the engine could not start, so the grid gives the reason instead of
 * saying no games are installed (issue #3423).
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GamePickerGrid } from "./GamePickerGrid";

afterEach(cleanup);

function renderGrid(scanError?: string | null) {
  return render(
    <GamePickerGrid
      games={[]}
      headers={new Map()}
      selectedName=""
      onSelect={() => {}}
      scanError={scanError}
    />,
  );
}

describe("GamePickerGrid with no games", () => {
  it("gives the reason when the content scan failed", () => {
    renderGrid("no space left on device");
    expect(screen.getByText(/no space left on device/)).toBeTruthy();
    expect(screen.queryByText(/No games are installed/)).toBeNull();
  });

  it("says no games are installed when the scan answered with none", () => {
    renderGrid();
    expect(screen.getByText(/No games are installed/)).toBeTruthy();
  });
});
