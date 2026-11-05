// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JoinSummary } from "../../connectors";

import { JoinedTo } from "./JoinedTo";

afterEach(cleanup);

const JOIN: JoinSummary = {
  parentName: "hull",
  connector: "+y",
  to: "-y",
  connectorName: "top",
  toName: "bottom",
  offset: [0.5, 0.25],
  twist: Math.PI / 2,
  broken: false,
  unbreakable: false,
  strength: null,
};

const noop = {
  onDetach: vi.fn(),
  onPlace: vi.fn(),
  showFree: false,
  onShowFreeChange: vi.fn(),
};

describe("JoinedTo", () => {
  it("names the parent and both faces, and detaches on request", () => {
    const onDetach = vi.fn();
    render(<JoinedTo join={JOIN} {...noop} onDetach={onDetach} />);
    expect(screen.getByText(/hull/)).toBeTruthy();
    expect(screen.getByText(/bottom/)).toBeTruthy();
    expect(screen.getByText(/top/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("says a free piece is free and offers no Detach", () => {
    render(<JoinedTo join={null} {...noop} />);
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Detach" })).toBeNull();
  });

  it("says why a piece was freed, on the line that otherwise says Free", () => {
    render(
      <JoinedTo join={null} {...noop} notice="Detached: moved off its face." />,
    );
    expect(screen.getByText("Detached: moved off its face.")).toBeTruthy();
    expect(screen.queryByText("Free")).toBeNull();
  });

  it("shows a join that cannot be made as broken, and still detaches", () => {
    render(<JoinedTo join={{ ...JOIN, broken: true }} {...noop} />);
    expect(screen.getByText(/Broken/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detach" })).toBeTruthy();
  });

  it("types the offset and twist in, twist in degrees", () => {
    const onPlace = vi.fn();
    render(<JoinedTo join={JOIN} {...noop} onPlace={onPlace} />);
    const along = screen.getByLabelText("Along");
    fireEvent.change(along, { target: { value: "1" } });
    fireEvent.blur(along);
    expect(onPlace).toHaveBeenLastCalledWith({ offset: [1, 0.25] });
    const up = screen.getByLabelText("Up");
    fireEvent.change(up, { target: { value: "-2" } });
    fireEvent.blur(up);
    expect(onPlace).toHaveBeenLastCalledWith({ offset: [0.5, -2] });
    const twist = screen.getByLabelText("Twist");
    fireEvent.change(twist, { target: { value: "180" } });
    fireEvent.blur(twist);
    expect(onPlace).toHaveBeenLastCalledWith({ twist: Math.PI });
  });

  it("shows the current offset and twist in degrees", () => {
    render(<JoinedTo join={JOIN} {...noop} />);
    expect((screen.getByLabelText("Along") as HTMLInputElement).value).toBe(
      "0.5",
    );
    expect((screen.getByLabelText("Twist") as HTMLInputElement).value).toBe(
      "90",
    );
  });

  it("offers no break marks unless the unit breaks apart", () => {
    render(<JoinedTo join={JOIN} {...noop} />);
    expect(screen.queryByRole("checkbox", { name: "Unbreakable" })).toBeNull();
    expect(screen.queryByLabelText("Strength")).toBeNull();
  });

  it("marks the join unbreakable, which hides its strength", () => {
    const onBreak = vi.fn();
    const { rerender } = render(
      <JoinedTo join={JOIN} {...noop} onBreak={onBreak} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Unbreakable" }));
    expect(onBreak).toHaveBeenCalledWith({ unbreakable: true });
    rerender(
      <JoinedTo
        join={{ ...JOIN, unbreakable: true }}
        {...noop}
        onBreak={onBreak}
      />,
    );
    expect(screen.queryByLabelText("Strength")).toBeNull();
  });

  it("types a strength in, and clearing it goes back to the size", () => {
    const onBreak = vi.fn();
    const { rerender } = render(
      <JoinedTo join={JOIN} {...noop} onBreak={onBreak} />,
    );
    const strength = screen.getByLabelText("Strength") as HTMLInputElement;
    expect(strength.value).toBe("");
    fireEvent.change(strength, { target: { value: "0.5" } });
    fireEvent.blur(strength);
    expect(onBreak).toHaveBeenLastCalledWith({ strength: 0.5 });

    rerender(
      <JoinedTo
        join={{ ...JOIN, strength: 0.5 }}
        {...noop}
        onBreak={onBreak}
      />,
    );
    const shown = screen.getByLabelText("Strength") as HTMLInputElement;
    expect(shown.value).toBe("0.5");
    fireEvent.change(shown, { target: { value: "" } });
    fireEvent.blur(shown);
    expect(onBreak).toHaveBeenLastCalledWith({ strength: null });
  });

  it("refuses a negative strength", () => {
    const onBreak = vi.fn();
    render(<JoinedTo join={JOIN} {...noop} onBreak={onBreak} />);
    const strength = screen.getByLabelText("Strength") as HTMLInputElement;
    fireEvent.change(strength, { target: { value: "-1" } });
    fireEvent.blur(strength);
    expect(onBreak).not.toHaveBeenCalled();
    expect(strength.value).toBe("");
  });

  it("toggles the free faces", () => {
    const onShowFreeChange = vi.fn();
    render(
      <JoinedTo join={null} {...noop} onShowFreeChange={onShowFreeChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Show free faces" }));
    expect(onShowFreeChange).toHaveBeenCalledWith(true);
  });
});
