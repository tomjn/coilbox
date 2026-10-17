// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BODY_PLANS } from "../../bodyPlans";
import { defaultTarget } from "../../skeletonSize";
import { NewUnitPopover } from "./NewUnitPopover";

afterEach(cleanup);

describe("NewUnitPopover", () => {
  it("starts a blank unit straight away when there are no plans", () => {
    const onChoose = vi.fn();
    render(<NewUnitPopover plans={[]} label="New unit" onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: /New unit/ }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("lists Blank first, then every registered plan with its description", () => {
    render(
      <NewUnitPopover
        plans={BODY_PLANS}
        label="New unit"
        onChoose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New unit/ }));

    const names = [...document.querySelectorAll("[data-plan-label]")].map(
      (item) => item.textContent,
    );
    expect(names).toEqual(["Blank", ...BODY_PLANS.map((plan) => plan.label)]);
    for (const plan of BODY_PLANS) {
      expect(screen.getByText(plan.description)).toBeTruthy();
    }
  });

  it("chooses Blank as null", () => {
    const onChoose = vi.fn();
    render(
      <NewUnitPopover
        plans={BODY_PLANS}
        label="New unit"
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New unit/ }));
    fireEvent.click(screen.getByRole("button", { name: /Blank/ }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(null);
  });

  function openOn(plan: (typeof BODY_PLANS)[number], onChoose = vi.fn()) {
    render(
      <NewUnitPopover
        plans={BODY_PLANS}
        label="New unit"
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New unit/ }));
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(plan.label) }),
    );
    return onChoose;
  }

  function type(label: RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it("asks for a size after a plan, starting from the plan's own", () => {
    const onChoose = openOn(BODY_PLANS[0]);

    expect(onChoose).not.toHaveBeenCalled();
    const fields = ["Footprint across", "Footprint deep", "Height"].map(
      (name) => (screen.getByLabelText(name) as HTMLInputElement).value,
    );
    const target = defaultTarget(BODY_PLANS[0]);
    expect(fields).toEqual([
      String(target.footprint.x),
      String(target.footprint.z),
      String(target.height),
    ]);
  });

  it("starts a plan at its default size and closes", () => {
    const onChoose = openOn(BODY_PLANS[0]);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(
      BODY_PLANS[0],
      defaultTarget(BODY_PLANS[0]),
    );
    expect(screen.queryByText("Start")).toBeNull();
  });

  it("starts a plan at the size typed", () => {
    const onChoose = openOn(BODY_PLANS[0]);
    type(/Footprint across/, "3");
    type(/Footprint deep/, "5");
    type(/Height/, "40");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(BODY_PLANS[0], {
      footprint: { x: 3, z: 5 },
      height: 40,
    });
  });

  it("does not start on a footprint that is not a whole number of steps", () => {
    const onChoose = openOn(BODY_PLANS[0]);
    type(/Footprint across/, "2.5");

    const start = screen.getByRole("button", { name: "Start" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("does not start on a height of nothing", () => {
    openOn(BODY_PLANS[0]);
    type(/Height/, "0");

    const start = screen.getByRole("button", { name: "Start" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
  });

  it("goes back to the list from the size", () => {
    const onChoose = openOn(BODY_PLANS[0]);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText(BODY_PLANS[1].description)).toBeTruthy();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("does not open while a unit is being made", () => {
    render(
      <NewUnitPopover
        plans={BODY_PLANS}
        label="New unit"
        busy
        onChoose={() => {}}
      />,
    );
    const button = screen.getByRole("button", {
      name: /New unit/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
