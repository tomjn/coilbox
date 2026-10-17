// @vitest-environment happy-dom

/**
 * The module list's filter row and the popover that labels a module
 * (issue #3298). `../../moduleFilter.test.ts` covers what a query keeps.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type LegoProject, newProject } from "../../model";
import { ModuleFilters, NoModuleMatches } from "./ModuleFilters";
import { ModuleLabelsPopover } from "./ModuleLabelsPopover";

function module(name: string, category?: string, tags?: string[]): LegoProject {
  return {
    ...newProject({
      id: name,
      rootPieceId: "root",
      name,
      packId: "lego",
      packVersion: "1",
      now: "2026-10-17T00:00:00Z",
    }),
    ...(category ? { category } : {}),
    ...(tags ? { tags } : {}),
  };
}

afterEach(cleanup);

describe("the module filter row", () => {
  it("reports what is typed into the search box", () => {
    const onQuery = vi.fn();
    render(
      <ModuleFilters
        compounds={[]}
        query=""
        onQuery={onQuery}
        category={null}
        onCategory={vi.fn()}
        shown={0}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search modules"), {
      target: { value: "gun" },
    });
    expect(onQuery).toHaveBeenCalledWith("gun");
  });

  it("says how many modules the grid is showing", () => {
    render(
      <ModuleFilters
        compounds={[]}
        query=""
        onQuery={vi.fn()}
        category={null}
        onCategory={vi.fn()}
        shown={1}
      />,
    );
    expect(screen.getByText("1 module")).toBeTruthy();
  });

  it("says so when a filter hides everything", () => {
    render(<NoModuleMatches />);
    expect(screen.getByText(/No module matches/)).toBeTruthy();
  });
});

describe("the labels popover", () => {
  function open(compound: LegoProject, known: LegoProject[], onSave = vi.fn()) {
    render(
      <ModuleLabelsPopover compound={compound} known={known} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: `Category and tags of the ${compound.name} compound`,
      }),
    );
    return onSave;
  }

  it("opens on the module's own category and tags", () => {
    const m = module("Big wheel", "Wheel", ["rubber", "heavy"]);
    open(m, [m]);
    expect(
      (screen.getByLabelText("Module category") as HTMLInputElement).value,
    ).toBe("Wheel");
    expect(
      (screen.getByLabelText("Module tags") as HTMLInputElement).value,
    ).toBe("rubber, heavy");
  });

  it("saves a typed category using the spelling already in use", () => {
    const m = module("Mystery");
    const other = module("Twin turret", "Turret");
    const onSave = open(m, [m, other]);
    fireEvent.change(screen.getByLabelText("Module category"), {
      target: { value: "turret" },
    });
    fireEvent.change(screen.getByLabelText("Module tags"), {
      target: { value: "gun, gun, big" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(m, {
      category: "Turret",
      tags: ["gun", "big"],
    });
  });

  it("fills the category from a suggestion", () => {
    const m = module("Mystery");
    open(m, [m]);
    fireEvent.click(screen.getByRole("button", { name: "Leg" }));
    expect(
      (screen.getByLabelText("Module category") as HTMLInputElement).value,
    ).toBe("Leg");
  });

  it("saves an emptied category as none", () => {
    const m = module("Big wheel", "Wheel");
    const onSave = open(m, [m]);
    fireEvent.change(screen.getByLabelText("Module category"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(m, { category: undefined, tags: [] });
  });
});
