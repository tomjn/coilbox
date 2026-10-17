// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JoinedTo } from "./JoinedTo";

afterEach(cleanup);

describe("JoinedTo", () => {
  it("names the parent and both faces, and detaches on request", () => {
    const onDetach = vi.fn();
    render(
      <JoinedTo
        join={{ parentName: "hull", connector: "+y", to: "-y", broken: false }}
        onDetach={onDetach}
      />,
    );
    expect(screen.getByText(/hull/)).toBeTruthy();
    expect(screen.getByText(/-y/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("says a free piece is free and offers no Detach", () => {
    render(<JoinedTo join={null} onDetach={vi.fn()} />);
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Detach" })).toBeNull();
  });

  it("shows a join that cannot be made as broken, and still detaches", () => {
    render(
      <JoinedTo
        join={{ parentName: "hull", connector: "+y", to: "nope", broken: true }}
        onDetach={vi.fn()}
      />,
    );
    expect(screen.getByText(/Broken/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detach" })).toBeTruthy();
  });
});
