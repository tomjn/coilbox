// @vitest-environment happy-dom

/**
 * The proportions panel: a typed number is one edit, a value outside the range
 * is held and says so, and a count that would delete bones with parts asks
 * first (issue #3253).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BIPED, type BodyPlan, projectFromPlan } from "../../bodyPlans";
import { BUILDING } from "../../buildingPlans";
import type { LegoProject } from "../../model";
import { projectFromTarget } from "../../skeletonSize";
import { WHEELED } from "../../vehiclePlans";
import { ProportionsPanel } from "./ProportionsPanel";

afterEach(cleanup);

function unit(plan: BodyPlan, proportions?: Record<string, number>) {
  let n = 0;
  return projectFromPlan(plan, {
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-01-01T00:00:00.000Z",
    newId: () => `piece-${++n}`,
    proportions,
  });
}

function show(project: LegoProject, plan: BodyPlan) {
  const onChange = vi.fn();
  const onPreview = vi.fn();
  const onTarget = vi.fn();
  const onRemove = vi.fn();
  render(
    <ProportionsPanel
      project={project}
      plan={plan}
      onChange={onChange}
      onPreview={onPreview}
      onTarget={onTarget}
      onRemove={onRemove}
      preview={null}
    />,
  );
  return { onChange, onPreview, onTarget, onRemove };
}

function type(label: string, text: string) {
  const field = screen.getByLabelText(new RegExp(`^${label}`));
  fireEvent.change(field, { target: { value: text } });
  fireEvent.blur(field);
}

describe("ProportionsPanel", () => {
  it("lists each proportion of the plan with its value", () => {
    show(unit(BIPED), BIPED);

    expect(
      (screen.getByLabelText(/^Stance width/) as HTMLInputElement).value,
    ).toBe("29.8");
    expect(screen.getAllByRole("slider")).toHaveLength(3);
  });

  it("makes one edit for a typed number", () => {
    const { onChange } = show(unit(BIPED), BIPED);

    type("Stance width", "40");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ stance: 40 });
  });

  it("holds a value outside the range and says so", () => {
    const { onChange } = show(unit(BIPED), BIPED);

    type("Stance width", "500");

    expect(onChange).toHaveBeenCalledWith({ stance: 60 });
    expect(screen.getByText("Held to 10 to 60.")).toBeTruthy();
  });

  it("makes no edit for a value that did not change", () => {
    const { onChange } = show(unit(BIPED), BIPED);

    type("Stance width", "29.8");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("asks before a count removes a bone that carries a part", () => {
    const project = unit(WHEELED, { axles: 3 });
    const wheel = project.pieces.find((p) => p.bone === "wheel.l3");
    if (!wheel) throw new Error("no wheel");
    const withPart: LegoProject = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.id === wheel.id ? { ...p, partId: "tyre" } : p,
      ),
    };
    const { onChange } = show(withPart, WHEELED);

    type("Axles", "2");
    expect(onChange).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain(wheel.name);
    expect(alert).toContain("stays where it is, on the bone above");
    expect(alert).not.toContain("and what is on");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith({ axles: 2 });
  });

  it("changes nothing when the warning is kept off", () => {
    const project = unit(WHEELED, { axles: 3 });
    const withPart: LegoProject = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.bone === "wheel.l3" ? { ...p, partId: "tyre" } : p,
      ),
    };
    const { onChange } = show(withPart, WHEELED);

    type("Axles", "2");
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("removes bare bones without asking", () => {
    const { onChange } = show(unit(WHEELED, { axles: 3 }), WHEELED);

    type("Axles", "2");

    expect(onChange).toHaveBeenCalledWith({ axles: 2 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("removes the skeleton only after a confirm", () => {
    const { onRemove } = show(unit(BIPED), BIPED);

    fireEvent.click(screen.getByRole("button", { name: "Remove skeleton" }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText("Keeps every piece.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  describe("size", () => {
    const options = {
      id: "u",
      rootPieceId: "root",
      name: "Unit",
      packId: "p",
      packVersion: "1",
      now: "2026-01-01T00:00:00.000Z",
      newId: (() => {
        let n = 0;
        return () => `piece-${++n}`;
      })(),
    };

    it("reads out the skeleton's size in steps, elmos and height", () => {
      show(
        unit(WHEELED, {
          axles: 3,
          axleSpacing: 20,
          trackWidth: 28,
          wheelHeight: 5,
        }),
        WHEELED,
      );

      expect(
        screen.getByText("Size 2 by 3 steps (28 by 40 elmos), 5 elmos tall"),
      ).toBeTruthy();
    });

    it("starts the target fields from the size when the unit has no target", () => {
      show(unit(WHEELED), WHEELED);

      expect(
        (screen.getByLabelText("Footprint across") as HTMLInputElement).value,
      ).toBe("2");
      expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe(
        "4.7",
      );
    });

    it("fits to the target typed", () => {
      const { onTarget } = show(unit(WHEELED), WHEELED);

      fireEvent.change(screen.getByLabelText("Footprint deep"), {
        target: { value: "4" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Fit" }));

      expect(onTarget).toHaveBeenCalledExactlyOnceWith({
        footprint: { x: 2, z: 4 },
        height: 4.7,
      });
    });

    it("does not fit to a target that is not a number", () => {
      const { onTarget } = show(unit(WHEELED), WHEELED);

      fireEvent.change(screen.getByLabelText("Height"), {
        target: { value: "tall" },
      });

      const fit = screen.getByRole("button", {
        name: "Fit",
      }) as HTMLButtonElement;
      expect(fit.disabled).toBe(true);
      expect(onTarget).not.toHaveBeenCalled();
    });

    it("says where the skeleton is past its target", () => {
      const fitted = projectFromTarget(
        WHEELED,
        { footprint: { x: 2, z: 2 }, height: 5 },
        options,
      );
      const longer: LegoProject = {
        ...fitted,
        skeleton: fitted.skeleton && {
          ...fitted.skeleton,
          proportions: { ...fitted.skeleton.proportions, axleSpacing: 40 },
        },
      };
      show(longer, WHEELED);

      expect(screen.getByText("Past the target in length.")).toBeTruthy();
    });

    it("says nothing about the target when the skeleton is inside it", () => {
      const fitted = projectFromTarget(
        WHEELED,
        { footprint: { x: 2, z: 2 }, height: 5 },
        options,
      );
      show(fitted, WHEELED);

      expect(screen.queryByText(/Past the target/)).toBeNull();
    });

    it("still offers a size to a plan with nothing to slide", () => {
      const building = projectFromTarget(
        BUILDING,
        { footprint: { x: 9, z: 9 }, height: 30 },
        options,
      );
      show(building, BUILDING);

      expect(
        screen.getByText("Size 9 by 9 steps (144 by 144 elmos), 30 elmos tall"),
      ).toBeTruthy();
      expect(screen.queryAllByRole("slider")).toHaveLength(0);
    });
  });

  describe("a fitted skeleton (#3261)", () => {
    it("shows what was measured and offers nothing to change", () => {
      const fitted: LegoProject = {
        ...unit(BIPED),
        skeleton: {
          plan: "biped",
          proportions: { legLength: 20 },
          fitted: true,
        },
      };
      show(fitted, BIPED);

      expect(screen.getByText("20 elmos")).toBeTruthy();
      expect(screen.getAllByText("Not measured")).toHaveLength(2);
      expect(screen.queryAllByRole("slider")).toHaveLength(0);
      expect(screen.queryAllByRole("textbox")).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Fit" })).toBeNull();
    });
  });
});
