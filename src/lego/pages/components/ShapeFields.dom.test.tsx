// @vitest-environment happy-dom

/**
 * Sizing a cylinder or a tube from the piece panel (#3327): the numbers go into
 * the shape, and a wall that does not fit is refused with a reason.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoShape } from "../../shapes";
import { ShapeFields } from "./ShapeFields";

const tube: LegoShape = {
  kind: "tube",
  size: [2, 3, 2],
  swatch: "grey",
  options: { axis: 1, sides: 12, inner: 0.75 },
};

const onChange = vi.fn();

beforeEach(() => onChange.mockReset());
afterEach(cleanup);

function type(label: string, value: string) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

describe("ShapeFields", () => {
  it("shows a tube's radius, length, wall and sides", () => {
    render(<ShapeFields shape={tube} onChange={onChange} />);
    expect(screen.getByLabelText<HTMLInputElement>("Radius").value).toBe("1");
    expect(screen.getByLabelText<HTMLInputElement>("Length").value).toBe("3");
    expect(screen.getByLabelText<HTMLInputElement>("Wall").value).toBe("0.25");
    expect(screen.getByLabelText<HTMLInputElement>("Sides").value).toBe("12");
  });

  it("has no wall for a cylinder", () => {
    render(
      <ShapeFields shape={{ ...tube, kind: "cylinder" }} onChange={onChange} />,
    );
    expect(screen.queryByLabelText("Wall")).toBeNull();
  });

  it("sets the length", () => {
    render(<ShapeFields shape={tube} onChange={onChange} />);
    type("Length", "5");
    expect(onChange.mock.calls[0][0].size).toEqual([2, 5, 2]);
  });

  it("turns it to lie along x", () => {
    render(<ShapeFields shape={tube} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "X" }));
    expect(onChange.mock.calls[0][0].size).toEqual([3, 2, 2]);
  });

  it("refuses a wall as thick as the radius and says why", () => {
    render(<ShapeFields shape={tube} onChange={onChange} />);
    type("Wall", "1");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Wall must be above 0 and below the radius.",
    );
  });
});

describe("ShapeFields for a wedge (#3328)", () => {
  const wedge: LegoShape = {
    kind: "wedge",
    size: [2, 4, 3],
    swatch: "green",
    options: { low: 1 },
  };

  it("shows width, depth, height and the low end", () => {
    render(<ShapeFields shape={wedge} onChange={onChange} />);
    expect(screen.getByLabelText<HTMLInputElement>("Width").value).toBe("2");
    expect(screen.getByLabelText<HTMLInputElement>("Depth").value).toBe("3");
    expect(screen.getByLabelText<HTMLInputElement>("Height").value).toBe("4");
    expect(screen.getByLabelText<HTMLInputElement>("Low end").value).toBe("1");
    expect(screen.queryByLabelText("Radius")).toBeNull();
  });

  it("sets the low end", () => {
    render(<ShapeFields shape={wedge} onChange={onChange} />);
    type("Low end", "2");
    expect(onChange.mock.calls[0][0].options.low).toBe(2);
  });

  it("flips the direction of the slope", () => {
    render(<ShapeFields shape={wedge} onChange={onChange} />);
    expect(
      screen
        .getByRole("button", { name: "High at back" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "High at front" }));
    expect(onChange.mock.calls[0][0].options.flip).toBe(1);
  });

  it("refuses a low end above the height and says why", () => {
    render(<ShapeFields shape={wedge} onChange={onChange} />);
    type("Low end", "9");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Low end must be between 0 and the height.",
    );
  });
});

describe("ShapeFields for a cone (#3329)", () => {
  const cone: LegoShape = {
    kind: "cone",
    size: [2, 3, 2],
    swatch: "green",
    options: { axis: 1, sides: 12, top: 0.5 },
  };

  it("shows the bottom radius, top radius, height and sides", () => {
    render(<ShapeFields shape={cone} onChange={onChange} />);
    expect(screen.getByLabelText<HTMLInputElement>("Bottom radius").value).toBe(
      "1",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Top radius").value).toBe(
      "0.5",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Height").value).toBe("3");
    expect(screen.getByLabelText<HTMLInputElement>("Sides").value).toBe("12");
    expect(screen.queryByLabelText("Wall")).toBeNull();
  });

  it("sets the top radius", () => {
    render(<ShapeFields shape={cone} onChange={onChange} />);
    type("Top radius", "0");
    expect(onChange.mock.calls[0][0].options.top).toBe(0);
  });

  it("says to use a cylinder for a top as wide as the bottom", () => {
    render(<ShapeFields shape={cone} onChange={onChange} />);
    type("Top radius", "1");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "A top as wide as the bottom is a cylinder. Add a cylinder instead.",
    );
  });
});
