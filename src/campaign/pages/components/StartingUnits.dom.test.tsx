// @vitest-environment happy-dom
/**
 * The units from the unit builder a conquest or warpath run begins with (issue
 * #4518), picked on its setup screen.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { projects } = vi.hoisted(() => ({ projects: [] as unknown[] }));

vi.mock("@/lego/projects", () => ({
  useLegoProjects: () => ({ projects, loading: false, error: null }),
}));

import { type LegoProject, newProject } from "@/lego/model";
import { StartingUnits } from "./StartingUnits";

function project(id: string, unitName: string, name: string): LegoProject {
  return {
    ...newProject({
      id,
      rootPieceId: "root",
      name,
      packId: "lego",
      packVersion: "1",
      now: "2026-10-01T00:00:00Z",
    }),
    unitName,
  };
}

const tank = project("p-tank", "tank", "Tank");
const other = project("p-other", "tank", "Other tank");
const jeep = project("p-jeep", "jeep", "Jeep");

afterEach(() => {
  cleanup();
  projects.length = 0;
});

function mount(picked: LegoProject[]) {
  const onChange = vi.fn();
  render(
    <StartingUnits
      label={<span>Units from the builder</span>}
      picked={picked}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("the units a conquest or run begins with", () => {
  it("shows nothing when the library has no units", () => {
    mount([]);
    expect(screen.queryByText("Units from the builder")).toBeNull();
  });

  it("adds a unit picked from the library", () => {
    projects.push(tank, jeep);
    const onChange = mount([]);
    fireEvent.click(screen.getByRole("button", { name: /Add unit/ }));
    fireEvent.click(screen.getByText("Jeep"));
    expect(onChange).toHaveBeenCalledWith([jeep]);
  });

  it("refuses a unit already picked, and one with a unit name already taken", () => {
    projects.push(tank, other, jeep);
    mount([tank]);
    fireEvent.click(screen.getByRole("button", { name: /Add unit/ }));
    expect(screen.getByText("Already attached")).toBeTruthy();
    const clash = screen.getByText("Other tank").closest("button");
    expect(clash?.hasAttribute("disabled")).toBe(true);
  });

  it("removes a picked unit", () => {
    projects.push(tank, jeep);
    const onChange = mount([tank, jeep]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Tank" }));
    expect(onChange).toHaveBeenCalledWith([jeep]);
  });
});
