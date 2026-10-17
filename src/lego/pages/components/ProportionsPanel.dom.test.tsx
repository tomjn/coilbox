// @vitest-environment happy-dom

/**
 * The proportions panel: a typed number is one edit, a value outside the range
 * is held and says so, and a count that would delete bones with parts asks
 * first (issue #3253).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BIPED, type BodyPlan, projectFromPlan } from "../../bodyPlans";
import type { LegoProject } from "../../model";
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
  render(
    <ProportionsPanel
      project={project}
      plan={plan}
      onChange={onChange}
      onPreview={onPreview}
      preview={null}
    />,
  );
  return { onChange, onPreview };
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
    expect(screen.getByRole("alert").textContent).toContain(wheel.name);

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
});
