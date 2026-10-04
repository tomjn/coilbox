// @vitest-environment happy-dom

/**
 * The threat level control on the conquest setup: unlocked levels can be chosen,
 * the next one is shown locked with what unlocks it, and nothing further along
 * is shown at all.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreatLevelSelect } from "./ThreatLevelSelect";

afterEach(cleanup);

const level = (n: number) =>
  screen.getByRole("radio", { name: new RegExp(`Level ${n}\\b`) });
const disabled = (n: number) => (level(n) as HTMLButtonElement).disabled;

describe("ThreatLevelSelect", () => {
  it("offers level 0 alone to a new player, with level 1 locked and its reason shown", () => {
    render(<ThreatLevelSelect value={0} ceiling={0} onChange={() => {}} />);
    expect(disabled(0)).toBe(false);
    expect(disabled(1)).toBe(true);
    expect(screen.getByText("Win a conquest", { exact: false })).toBeTruthy();
    expect(screen.getByText(/Level 1 is locked/)).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Level 2\b/ })).toBeNull();
  });

  it("lets every unlocked level be chosen and names what unlocks the next", () => {
    const onChange = vi.fn();
    render(<ThreatLevelSelect value={0} ceiling={2} onChange={onChange} />);
    expect(disabled(1)).toBe(false);
    expect(disabled(2)).toBe(false);
    expect(disabled(3)).toBe(true);
    expect(screen.getByText(/Win a conquest at level 2/)).toBeTruthy();
    fireEvent.click(level(2));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("does nothing when the locked level is pressed", () => {
    const onChange = vi.fn();
    render(<ThreatLevelSelect value={0} ceiling={0} onChange={onChange} />);
    fireEvent.click(level(1));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows nothing locked once every level is unlocked", () => {
    render(<ThreatLevelSelect value={3} ceiling={3} onChange={() => {}} />);
    expect(disabled(3)).toBe(false);
    expect(screen.queryByText(/is locked/)).toBeNull();
  });

  it("marks the chosen level and says what it does", () => {
    render(<ThreatLevelSelect value={1} ceiling={1} onChange={() => {}} />);
    expect(level(1).getAttribute("aria-checked")).toBe("true");
    expect(level(0).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("threat-level-note").textContent).not.toBe("");
  });

  it("keeps the chosen level when it is pressed again", () => {
    const onChange = vi.fn();
    render(<ThreatLevelSelect value={1} ceiling={1} onChange={onChange} />);
    fireEvent.click(level(1));
    expect(onChange).not.toHaveBeenCalled();
  });
});
