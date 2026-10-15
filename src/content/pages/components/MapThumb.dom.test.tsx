// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapThumb } from "./MapThumb";

afterEach(cleanup);

describe("MapThumb", () => {
  it("shows a spinner rather than a pulsing block while loading", () => {
    const { container } = render(<MapThumb loading alt="Test map" />);

    const status = screen.getByRole("status", { name: "Loading minimap" });
    expect(status.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );
    expect(container.innerHTML).not.toContain("animate-pulse");
  });
});
