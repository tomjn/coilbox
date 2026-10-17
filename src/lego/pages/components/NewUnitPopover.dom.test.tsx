// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BODY_PLANS } from "../../bodyPlans";
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

  it("chooses a plan and closes", () => {
    const onChoose = vi.fn();
    render(
      <NewUnitPopover
        plans={BODY_PLANS}
        label="New unit"
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New unit/ }));
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(BODY_PLANS[0].label) }),
    );

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(BODY_PLANS[0]);
    expect(screen.queryByText(BODY_PLANS[0].description)).toBeNull();
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
