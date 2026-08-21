// @vitest-environment happy-dom

/**
 * What the shared bar of view controls renders (issue #1870).
 *
 * The two things worth guarding are the ones an editor would otherwise get
 * wrong on its own: every button says what it does, and a toggle reports which
 * way it is set. A toggle that does not report its state is worse than no
 * toggle, because a screen reader reads it as a button that does nothing.
 *
 * happy-dom does no layout, so nothing here can say the bar is in the bottom
 * right corner or that its buttons are flush against each other. The class it
 * carries is checked instead, and the pull request has the screenshots.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Box } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GridToggle,
  ResetViewButton,
  ViewButton,
  ViewControls,
  ViewToggle,
} from "./ViewControls";

afterEach(cleanup);

describe("ViewControls", () => {
  it("puts the bar in the viewport's bottom right corner", () => {
    const { container } = render(
      <ViewControls>
        <ViewButton title="Reset the view" onClick={() => {}}>
          <Box />
        </ViewButton>
      </ViewControls>,
    );

    const bar = container.querySelector("[data-slot=button-group]");
    expect(bar?.className).toContain("absolute bottom-3 right-3");
  });

  it("groups its controls as one cluster", () => {
    render(
      <ViewControls>
        <ViewButton title="One" onClick={() => {}}>
          <Box />
        </ViewButton>
        <ViewButton title="Two" onClick={() => {}}>
          <Box />
        </ViewButton>
      </ViewControls>,
    );

    expect(screen.getByRole("group").children).toHaveLength(2);
  });
});

describe("ViewToggle", () => {
  it("reports whether the thing it shows is on", () => {
    const { rerender } = render(
      <ViewToggle
        icon={Box}
        on
        onChange={() => {}}
        hideTitle="Hide the collision volume"
        showTitle="Show the collision volume"
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Hide the collision volume" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(
      <ViewToggle
        icon={Box}
        on={false}
        onChange={() => {}}
        hideTitle="Hide the collision volume"
        showTitle="Show the collision volume"
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Show the collision volume" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("says which way pressing it will go", () => {
    const onChange = vi.fn();
    render(
      <ViewToggle
        icon={Box}
        on
        onChange={onChange}
        hideTitle="Hide the collision volume"
        showTitle="Show the collision volume"
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("the controls every editor is offered", () => {
  it("names the grid toggle after what the grid is on this surface", () => {
    render(
      <GridToggle
        on={false}
        onChange={() => {}}
        showTitle="Show the ground grid, marked in footprint steps"
      />,
    );

    screen.getByRole("button", {
      name: "Show the ground grid, marked in footprint steps",
    });
  });

  it("frames the view when reset is pressed", () => {
    const onClick = vi.fn();
    render(<ResetViewButton onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset the view" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("lets a surface say what reset will frame", () => {
    render(<ResetViewButton onClick={() => {}} title="Frame the map" />);

    screen.getByRole("button", { name: "Frame the map" });
  });
});
