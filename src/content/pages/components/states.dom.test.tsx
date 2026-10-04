// @vitest-environment happy-dom

/**
 * The empty state a page draws for a game it cannot find in the scan (issue
 * #3398). A scan whose unitsync `Init` failed has no games because the engine
 * could not start, so the page says that and not that the game is absent.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameMissingState } from "./states";

afterEach(cleanup);

describe("GameMissingState", () => {
  it("says the scan failed, with the reason, and not that the game is missing", () => {
    render(
      <GameMissingState
        initFailure="no space left"
        label="Foo is not installed here."
      />,
    );
    expect(screen.queryByText(/not installed here/)).toBeNull();
    expect(screen.getByText(/no space left/)).toBeTruthy();
  });

  it("says the game is missing when the scan answered", () => {
    render(
      <GameMissingState
        initFailure={null}
        label="Foo is not installed here."
      />,
    );
    expect(screen.getByText("Foo is not installed here.")).toBeTruthy();
  });
});
