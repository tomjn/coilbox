// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StartPolygonOverlay } from "./StartPolygonOverlay";

afterEach(cleanup);

const WEST = {
  key: "0",
  label: "W",
  title: "West",
  color: "#f5f5f5",
  polygons: [
    [
      [0, 0],
      [0, 6144],
      [800, 6144],
      [800, 0],
    ] as [number, number][],
  ],
  points: [[500, 1000]] as [number, number][],
};

describe("StartPolygonOverlay", () => {
  it("draws each polygon, its start points and its name", () => {
    const { container } = render(
      <StartPolygonOverlay areas={[WEST]} extent={{ x: 7168, z: 6144 }} />,
    );
    // The hairline and the coloured edge.
    expect(container.querySelectorAll("polygon")).toHaveLength(2);
    const label = screen.getByText("W");
    expect(label.getAttribute("title")).toBe("West");
    const point = container.querySelector("span[aria-hidden]") as HTMLElement;
    expect(point.style.left).toBe(`${(500 / 7168) * 100}%`);
    expect(point.style.top).toBe(`${(1000 / 6144) * 100}%`);
  });

  it("draws nothing until the map's size is known", () => {
    const { container } = render(
      <StartPolygonOverlay areas={[WEST]} extent={null} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
