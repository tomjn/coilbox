// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MissingDependencyBanner } from "./states";

afterEach(cleanup);

describe("MissingDependencyBanner", () => {
  it("lists the missing archives and says what it costs", () => {
    render(
      <MissingDependencyBanner
        notes={['Depends on "zero-k v1.7.6.4", which is not installed.']}
      />,
    );
    expect(
      screen.getByText("A dependency of this game is missing"),
    ).toBeTruthy();
    expect(
      screen.getByText('Depends on "zero-k v1.7.6.4", which is not installed.'),
    ).toBeTruthy();
    expect(screen.getByText(/stops in the engine/)).toBeTruthy();
  });
});
