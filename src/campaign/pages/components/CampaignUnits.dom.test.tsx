// @vitest-environment happy-dom
/**
 * The campaign editor's Units section (issue #4516). A copy changes only when
 * the author asks for it, and the document is saved before a copy is removed.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { drawerOpen, projects, updateUnit, detachCopy, attachUnit } = vi.hoisted(
  () => ({
    drawerOpen: vi.fn(),
    projects: [] as unknown[],
    updateUnit: vi.fn(),
    detachCopy: vi.fn(),
    attachUnit: vi.fn(),
  }),
);

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: drawerOpen, close: () => {}, isOpen: false }),
}));
vi.mock("@/lego/projects", () => ({
  useLegoProjects: () => ({ projects, loading: false, error: null }),
}));
vi.mock("@/workshop/project", () => ({
  useModProjects: () => ({ projects: [] }),
}));
vi.mock("@/lego/pack", () => ({ loadPack: async () => ({}) }));
vi.mock("@/lego/rawGeometry", () => ({
  loadRawGeometryIfAny: async () => null,
}));
vi.mock("../../units", async (original) => ({
  ...(await original<typeof import("../../units")>()),
  attachUnit,
  updateUnit,
  detachCopy,
}));

import type { Campaign } from "../../model";
import { CampaignUnits } from "./CampaignUnits";

const tank = {
  unitName: "tank",
  projectId: "p-tank",
  name: "Tank",
  builtBy: [],
  copiedAt: "2026-10-02T00:00:00Z",
};

const campaign: Campaign = {
  schemaVersion: 1,
  id: "c1",
  type: "ta",
  title: "A Campaign",
  description: "",
  missions: [],
  units: [tank],
  createdAt: "",
  updatedAt: "",
};

/** Records each change and what it made of the campaign. */
function changes() {
  const made: Campaign[] = [];
  const order: string[] = [];
  const onChange = vi.fn(async (change: (c: Campaign) => Campaign) => {
    order.push("saved");
    made.push(change(campaign));
  });
  return { made, order, onChange };
}

beforeEach(() => {
  projects.length = 0;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("CampaignUnits", () => {
  it("marks a unit changed in the library without touching its copy", () => {
    projects.push({
      id: "p-tank",
      name: "Tank",
      unitName: "tank",
      updatedAt: "2026-10-05T00:00:00Z",
    });
    const { onChange } = changes();
    render(<CampaignUnits campaign={campaign} onChange={onChange} />);

    expect(screen.getByText(/Changed in the library/)).toBeTruthy();
    expect(updateUnit).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes a fresh copy on Update from library", async () => {
    projects.push({
      id: "p-tank",
      name: "Tank",
      unitName: "tank",
      updatedAt: "2026-10-05T00:00:00Z",
    });
    const fresh = { ...tank, copiedAt: "2026-10-06T00:00:00Z" };
    updateUnit.mockResolvedValue({ unit: fresh, replaces: null });
    const { made, onChange } = changes();
    render(<CampaignUnits campaign={campaign} onChange={onChange} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Update from library/ }),
    );

    await waitFor(() => expect(made).toHaveLength(1));
    expect(made[0].units).toEqual([fresh]);
    expect(detachCopy).not.toHaveBeenCalled();
  });

  it("cannot update a unit no longer in the library", () => {
    const { onChange } = changes();
    render(<CampaignUnits campaign={campaign} onChange={onChange} />);

    expect(screen.getByText(/Not in the library/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /Update from library/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("saves the document before removing the copy", async () => {
    const { made, order, onChange } = changes();
    detachCopy.mockImplementation(async () => {
      order.push("deleted");
    });
    render(<CampaignUnits campaign={campaign} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Tank" }));

    await waitFor(() => expect(order).toEqual(["saved", "deleted"]));
    expect(made[0].units).toBeUndefined();
    expect(detachCopy).toHaveBeenCalledWith("c1", "tank");
  });

  it("opens the library in a drawer to attach a unit", () => {
    const { onChange } = changes();
    render(<CampaignUnits campaign={campaign} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Attach unit/ }));

    expect(drawerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Attach a unit" }),
    );
  });
});
