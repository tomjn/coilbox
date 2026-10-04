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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import { GameOptionsPanel, ModOptionField } from "./GameOptionsPanel";

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

describe("the changed mark (issue #3388)", () => {
  const flag: ConfigOption = {
    key: "fixedallies",
    name: "Fixed allies",
    type: "bool",
    default: "1",
  };
  const mode: ConfigOption = {
    key: "mode",
    name: "Mode",
    type: "list",
    default: "e",
    listItems: [
      { key: "e", name: "Easy" },
      { key: "h", name: "Hard" },
    ],
  };

  it("marks a number that differs and says what the default is", () => {
    render(
      <ModOptionField option={maxUnits} value="6000" onChange={() => {}} />,
    );

    expect(screen.getByText("changed")).toBeTruthy();
    expect(screen.getByText("Default: 5000")).toBeTruthy();
  });

  it("marks nothing for an option nobody set", () => {
    render(<ModOptionField option={maxUnits} onChange={() => {}} />);

    expect(screen.queryByText("changed")).toBeNull();
    expect(screen.queryByText(/^Default:/)).toBeNull();
  });

  it("marks nothing for a default in another spelling", () => {
    render(
      <ModOptionField option={maxUnits} value="5000.0" onChange={() => {}} />,
    );

    expect(screen.queryByText("changed")).toBeNull();
  });

  it("marks a bool and says On or Off", () => {
    render(<ModOptionField option={flag} value="0" onChange={() => {}} />);

    expect(screen.getByText("changed")).toBeTruthy();
    expect(screen.getByText("Default: On")).toBeTruthy();
  });

  it("marks a list and names the default item", () => {
    render(<ModOptionField option={mode} value="h" onChange={() => {}} />);

    expect(screen.getByText("changed")).toBeTruthy();
    expect(screen.getByText("Default: Easy")).toBeTruthy();
  });

  it("counts changes in a section header and opens the section", () => {
    const options: ConfigOption[] = [
      { key: "eco", name: "Economy", type: "section" },
      { ...maxUnits, section: "eco" },
      { ...flag, section: "eco" },
      { key: "quiet", name: "Quiet", type: "section" },
      { ...mode, section: "quiet" },
    ];
    render(
      <GameOptionsPanel
        options={options}
        optionValues={{ maxunits: "6000", fixedallies: "0" }}
        onOptionChange={() => {}}
      />,
    );

    const eco = screen.getByText("Economy").closest("button");
    expect(within(eco as HTMLElement).getByText("2 changed")).toBeTruthy();
    const quiet = screen.getByText("Quiet").closest("button");
    expect(within(quiet as HTMLElement).queryByText(/changed/)).toBeNull();
    expect(screen.getAllByText("changed")).toHaveLength(2);
  });
});

describe("resetting options (issue #3387)", () => {
  const flag: ConfigOption = {
    key: "fixedallies",
    name: "Fixed allies",
    type: "bool",
    default: "1",
  };
  const options: ConfigOption[] = [
    { key: "eco", name: "Economy", type: "section" },
    { ...maxUnits, section: "eco" },
    { ...flag, section: "eco" },
    { key: "top", name: "Top level", type: "number", default: "3" },
  ];

  const confirm = () =>
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "Reset" })
        .find((b) => b.closest("[data-slot=popover-content]")) as HTMLElement,
    );

  it("resets one changed row by reporting no override", () => {
    const onChange = vi.fn();
    render(
      <ModOptionField option={maxUnits} value="6000" onChange={onChange} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reset Max units to its default" }),
    );

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("offers no row reset on an unchanged row", () => {
    render(<ModOptionField option={maxUnits} onChange={() => {}} />);

    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
  });

  it("offers no row reset when the field cannot be edited", () => {
    render(
      <ModOptionField
        option={maxUnits}
        value="6000"
        disabled
        onChange={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
  });

  it("has no group reset while nothing is changed", () => {
    render(
      <GameOptionsPanel
        options={options}
        optionValues={{}}
        onOptionChange={() => {}}
        onOptionValuesChange={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();
  });

  it("resets a section after a confirm that shows the count, and only that section", () => {
    const onValues = vi.fn();
    render(
      <GameOptionsPanel
        options={options}
        optionValues={{ maxunits: "6000", fixedallies: "0", top: "9" }}
        onOptionChange={() => {}}
        onOptionValuesChange={onValues}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Economy" }));
    expect(screen.getByText("Reset 2 options to their defaults?")).toBeTruthy();
    expect(onValues).not.toHaveBeenCalled();

    confirm();

    expect(onValues).toHaveBeenCalledWith({ top: "9" });
  });

  it("resets every changed option from the panel header", () => {
    const onValues = vi.fn();
    render(
      <GameOptionsPanel
        options={options}
        optionValues={{ maxunits: "6000", top: "9", elsewhere: "x" }}
        onOptionChange={() => {}}
        onOptionValuesChange={onValues}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Game options" }));
    expect(screen.getByText("Reset 2 options to their defaults?")).toBeTruthy();
    confirm();

    expect(onValues).toHaveBeenCalledWith({ elsewhere: "x" });
  });

  it("offers no group reset when the panel is disabled", () => {
    render(
      <GameOptionsPanel
        options={options}
        optionValues={{ maxunits: "6000" }}
        onOptionChange={() => {}}
        onOptionValuesChange={() => {}}
        disabled
      />,
    );

    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();
  });
});
