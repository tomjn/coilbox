// @vitest-environment happy-dom

/**
 * What the Change part drawer offers and what a click picks, under a colourway
 * and under All categories (#4540). The grid is replaced with a list of
 * buttons, because what is under test is which parts reach it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LegoPartInfo, LoadedPack } from "../../pack";

vi.mock("./TileGrid", () => ({
  TileGrid: ({
    sections,
    onPick,
  }: {
    sections: {
      label: string;
      total: number;
      items: { kind: "part"; part: LegoPartInfo }[];
    }[];
    onPick: (item: { kind: "part"; part: LegoPartInfo }) => void;
  }) => (
    <ul aria-label="parts" data-total={sections[0].total}>
      {sections[0].items.map((item) => (
        <li key={item.part.id}>
          <button type="button" onClick={() => onPick(item)}>
            {item.part.id}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

import { SwapPartDrawer } from "./SwapPartDrawer";

const part = (id: string, shapeId: string, colourway: string) =>
  ({
    id,
    shapeId,
    name: id,
    category: colourway,
    colourway,
    material: "",
    tags: [],
    sourceNames: [],
    packId: "lego",
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
  }) as unknown as LegoPartInfo;

const parts = [
  part("beam-grey", "beam", "grey"),
  part("beam-tan", "beam", "tan"),
  part("block-grey", "block", "grey"),
  part("block-tan", "block", "tan"),
  part("hull-grey", "hull", "grey"),
  part("panel-mixed", "panel", "mixed"),
];

const pack = {
  manifest: {
    categories: [
      { id: "tan", label: "Tan" },
      { id: "grey", label: "Grey" },
      { id: "mixed", label: "Mixed" },
    ],
  },
  library: { packs: [], atlases: [], dir: "", problems: [] },
  parts,
  byId: new Map(parts.map((p) => [p.id, p])),
} as unknown as LoadedPack;

function show(current: LegoPartInfo) {
  const onPick = vi.fn();
  render(
    <SwapPartDrawer
      open
      onOpenChange={vi.fn()}
      pack={pack}
      current={current}
      onPick={onPick}
    />,
  );
  return onPick;
}

const offered = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => li.textContent)
    .filter(Boolean);

function pickCategory(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

afterEach(cleanup);

describe("the Change part drawer", () => {
  it("offers every other part under All categories, the piece's colourways first", () => {
    const onPick = show(parts[0]);
    expect(offered()).toEqual([
      "beam-tan",
      "block-tan",
      "block-grey",
      "hull-grey",
      "panel-mixed",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "block-grey" }));
    expect(onPick).toHaveBeenCalledWith(parts[2]);
  });

  it("offers each shape once in a colourway, and the mixed part", () => {
    const onPick = show(parts[0]);
    pickCategory("Tan");
    expect(offered()).toEqual(["beam-tan", "block-tan", "panel-mixed"]);
    expect(screen.getByLabelText("parts").getAttribute("data-total")).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "block-tan" }));
    expect(onPick).toHaveBeenCalledWith(parts[3]);
  });

  it("leaves out a shape the colourway does not have", () => {
    show(parts[0]);
    pickCategory("Tan");
    expect(offered()).not.toContain("hull-grey");
  });
});
