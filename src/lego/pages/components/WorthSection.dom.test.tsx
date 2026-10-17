// @vitest-environment happy-dom

/**
 * The worth table in the builder (issue #3280): the live totals, editing the
 * table, and sharing one table between units.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type LegoProject, newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { type LegoWorth, PLACEHOLDER_WORTH } from "../../worth";
import { WorthSection } from "./WorthSection";

const saved = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useSetting: () => [
    saved.value,
    (next: unknown) => {
      saved.value = next;
    },
  ],
}));

const pack = {
  byId: new Map<string, LegoPartInfo>([
    [
      "block",
      {
        id: "block",
        shape: "block",
        bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
      } as LegoPartInfo,
    ],
  ]),
} as unknown as LoadedPack;

const TABLE: LegoWorth = {
  base: { health: 100, metal: 10, energy: 4, buildTime: 20, mass: 1 },
  perVolume: { health: 10, metal: 2, energy: 1, buildTime: 3, mass: 0.5 },
};

function unit(over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Cube",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "a",
        name: "a",
        parentId: "root",
        partId: "block",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  saved.value = null;
});

describe("WorthSection", () => {
  it("shows the totals for the unit's parts", () => {
    render(
      <WorthSection
        project={unit({ worth: TABLE })}
        pack={pack}
        onWorthChange={vi.fn()}
      />,
    );
    // One 2 by 2 by 2 block: volume 8.
    expect(screen.getByLabelText("Total health").textContent).toBe("180");
    expect(screen.getByLabelText("Total metal").textContent).toBe("26");
    expect(screen.getByLabelText("Total mass").textContent).toBe("5");
  });

  it("says a unit imported from a model has no parts to total", () => {
    render(
      <WorthSection
        project={unit({ imported: {} as LegoProject["imported"] })}
        pack={pack}
        onWorthChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/no parts/i)).toBeTruthy();
    expect(screen.queryByLabelText("Total health")).toBeNull();
  });

  it("writes an edited amount into the table", () => {
    const onWorthChange = vi.fn();
    render(
      <WorthSection
        project={unit({ worth: TABLE })}
        pack={pack}
        onWorthChange={onWorthChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Per volume health"), {
      target: { value: "25" },
    });
    expect(onWorthChange).toHaveBeenCalledWith({
      ...TABLE,
      perVolume: { ...TABLE.perVolume, health: 25 },
    });
  });

  it("starts from the placeholder table when the unit has none", () => {
    const onWorthChange = vi.fn();
    render(
      <WorthSection
        project={unit()}
        pack={pack}
        onWorthChange={onWorthChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Per unit metal"), {
      target: { value: "7" },
    });
    expect(onWorthChange).toHaveBeenCalledWith({
      ...PLACEHOLDER_WORTH,
      base: { ...PLACEHOLDER_WORTH.base, metal: 7 },
    });
  });

  it("offers a row for each shape the unit uses, and a blank falls back", () => {
    const onWorthChange = vi.fn();
    render(
      <WorthSection
        project={unit({ worth: TABLE })}
        pack={pack}
        onWorthChange={onWorthChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Block health"), {
      target: { value: "40" },
    });
    expect(onWorthChange).toHaveBeenLastCalledWith({
      ...TABLE,
      shapes: { block: { health: 40 } },
    });
  });

  it("drops a shape override when its field is cleared", () => {
    const onWorthChange = vi.fn();
    render(
      <WorthSection
        project={unit({
          worth: { ...TABLE, shapes: { block: { health: 40 } } },
        })}
        pack={pack}
        onWorthChange={onWorthChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Block health"), {
      target: { value: "" },
    });
    expect(onWorthChange).toHaveBeenLastCalledWith(TABLE);
  });

  it("saves the table for other units and loads it into this one", () => {
    const onWorthChange = vi.fn();
    const { rerender } = render(
      <WorthSection
        project={unit({ worth: TABLE })}
        pack={pack}
        onWorthChange={onWorthChange}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Use saved table",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save table" }));
    expect(saved.value).toEqual(TABLE);

    rerender(
      <WorthSection
        project={unit()}
        pack={pack}
        onWorthChange={onWorthChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use saved table" }));
    expect(onWorthChange).toHaveBeenCalledWith(TABLE);
  });
});
