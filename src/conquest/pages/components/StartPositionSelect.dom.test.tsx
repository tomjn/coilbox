// @vitest-environment happy-dom

/**
 * The start position control on the conquest setup (issue #3432): the edge
 * start is always open, the centre start is locked with what unlocks it until
 * it is earned.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartPositionSelect } from "./StartPositionSelect";

afterEach(cleanup);

const edge = () => screen.getByRole("radio", { name: /Edge/ });
const centre = () => screen.getByRole("radio", { name: /Centre/ });

describe("StartPositionSelect", () => {
  it("keeps the edge start open and shows the centre locked with its reason", () => {
    const onChange = vi.fn();
    render(
      <StartPositionSelect value="edge" unlocked={false} onChange={onChange} />,
    );
    expect((edge() as HTMLButtonElement).disabled).toBe(false);
    expect((centre() as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(/Centre is locked\. Win a conquest\./),
    ).toBeTruthy();
    fireEvent.click(centre());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets the centre be chosen once it is unlocked", () => {
    const onChange = vi.fn();
    render(
      <StartPositionSelect value="edge" unlocked={true} onChange={onChange} />,
    );
    expect((centre() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/is locked/)).toBeNull();
    fireEvent.click(centre());
    expect(onChange).toHaveBeenCalledWith("centre");
  });

  it("keeps the chosen start when it is pressed again", () => {
    const onChange = vi.fn();
    render(
      <StartPositionSelect
        value="centre"
        unlocked={true}
        onChange={onChange}
      />,
    );
    fireEvent.click(centre());
    expect(onChange).not.toHaveBeenCalled();
    expect(centre().getAttribute("aria-checked")).toBe("true");
  });
});
