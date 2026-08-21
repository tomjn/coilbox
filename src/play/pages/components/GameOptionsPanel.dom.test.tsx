// @vitest-environment happy-dom

/**
 * What a mod option's control shows and what it reports back (issue #1836).
 *
 * The panel used to put a number or string option's default in the box's
 * placeholder, so it read as blank next to a tick box showing its default as
 * real state. These tests pin the two halves of the fix: the default is the
 * box's value, and emptying the box drops the override instead of storing a
 * blank the engine cannot use.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import { ModOptionField } from "./GameOptionsPanel";

afterEach(cleanup);

const maxUnits: ConfigOption = {
  key: "maxunits",
  name: "Max units",
  type: "number",
  default: "5000",
};

const box = () => screen.getByLabelText("Max units") as HTMLInputElement;

describe("ModOptionField", () => {
  it("shows the game's default as the box's value, not as a placeholder", () => {
    render(<ModOptionField option={maxUnits} onChange={() => {}} />);

    expect(box().value).toBe("5000");
  });

  it("shows the user's value once they have one", () => {
    render(
      <ModOptionField option={maxUnits} value="6000" onChange={() => {}} />,
    );

    expect(box().value).toBe("6000");
  });

  it("reports what was typed", () => {
    const onChange = vi.fn();
    render(<ModOptionField option={maxUnits} onChange={onChange} />);

    fireEvent.change(box(), { target: { value: "1000" } });

    expect(onChange).toHaveBeenCalledWith("1000");
  });

  it("lets the box be emptied while you type, reporting nothing yet", () => {
    const onChange = vi.fn();
    render(
      <ModOptionField option={maxUnits} value="6000" onChange={onChange} />,
    );

    fireEvent.change(box(), { target: { value: "" } });

    expect(box().value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops the override when a box left empty loses focus", () => {
    const onChange = vi.fn();
    render(
      <ModOptionField option={maxUnits} value="6000" onChange={onChange} />,
    );

    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.blur(box());

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("puts the default back in the box when the empty box loses focus", () => {
    render(<ModOptionField option={maxUnits} onChange={() => {}} />);

    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.blur(box());

    expect(box().value).toBe("5000");
  });

  it("reports nothing when an option nobody set is emptied", () => {
    const onChange = vi.fn();
    render(<ModOptionField option={maxUnits} onChange={onChange} />);

    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.blur(box());

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not report anything just for being rendered", () => {
    const onChange = vi.fn();
    render(
      <ModOptionField
        option={{ key: "name", name: "Server message", type: "string" }}
        onChange={onChange}
      />,
    );

    expect(onChange).not.toHaveBeenCalled();
  });
});
