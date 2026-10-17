// @vitest-environment happy-dom

/** The measure readout: each figure in elmos and in steps, and Clear. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { DragReadout, MeasureReadout, PieceSize } from "./MeasureReadout";

afterEach(cleanup);

describe("MeasureReadout", () => {
  it("asks for the first point when there is nothing yet", () => {
    render(
      <MeasureReadout
        measurements={[]}
        start={null}
        hover={null}
        step={0.25}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText("Click the first point")).toBeTruthy();
    expect(screen.queryByText("Clear")).toBeNull();
  });

  it("gives a measurement's length and axes in elmos and steps", () => {
    render(
      <MeasureReadout
        measurements={[{ id: "a", from: [0, 0, 0], to: [3, 4, 0] }]}
        start={null}
        hover={null}
        step={0.25}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText("1. 5 elmos, 20 steps")).toBeTruthy();
    expect(screen.getByText("X 3, Y 4, Z 0 elmos")).toBeTruthy();
    expect(screen.getByText("X 12, Y 16, Z 0 steps")).toBeTruthy();
  });

  it("gives elmos only when the pack has no step", () => {
    render(
      <MeasureReadout
        measurements={[{ id: "a", from: [0, 0, 0], to: [3, 4, 0] }]}
        start={null}
        hover={null}
        step={null}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText("1. 5 elmos")).toBeTruthy();
    expect(screen.queryByText(/steps/)).toBeNull();
  });

  it("follows the pointer from a first point", () => {
    render(
      <MeasureReadout
        measurements={[]}
        start={[0, 0, 0]}
        hover={[1, 0, 0]}
        step={0.25}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText("1 elmo, 4 steps")).toBeTruthy();
  });

  it("clears on one click", () => {
    const onClear = vi.fn();
    render(
      <MeasureReadout
        measurements={[{ id: "a", from: [0, 0, 0], to: [1, 0, 0] }]}
        start={null}
        hover={null}
        step={0.25}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("DragReadout", () => {
  it("shows how far the piece moved and its size", () => {
    render(<DragReadout moved={[1, 0, -0.5]} size={[2, 1, 1]} step={0.25} />);
    expect(screen.getByText("X 1, Y 0, Z -0.5 elmos")).toBeTruthy();
    expect(screen.getByText("X 4, Y 0, Z -2 steps")).toBeTruthy();
    expect(screen.getByText("X 2, Y 1, Z 1 elmos")).toBeTruthy();
  });

  it("leaves the size out for a piece with no geometry", () => {
    render(<DragReadout moved={[1, 0, 0]} size={null} step={0.25} />);
    expect(screen.queryByText("Size")).toBeNull();
  });
});

describe("PieceSize", () => {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 2, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  const pack: LoadedPack = {
    manifest: { unit: 0.5 } as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  };
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const project = {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "a",
        name: "a",
        parentId: "root",
        partId: "tri",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
    ],
  };

  it("reads the size in elmos and in the pack's steps", () => {
    render(<PieceSize project={project} pack={pack} raw={null} pieceId="a" />);
    expect(screen.getByText("X 1, Y 2, Z 1 elmos")).toBeTruthy();
    expect(screen.getByText("X 2, Y 4, Z 2 steps")).toBeTruthy();
  });
});
