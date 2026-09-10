// @vitest-environment happy-dom

/**
 * The file manager is a separate app, so a "Show me" that fails has to say so
 * in coilbox or it looks like a button that does nothing.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShowMe } from "./ShowMe";

const legoOpenPath = vi.fn();

vi.mock("../../bindings", () => ({
  legoOpenPath: (args: { path: string }) => legoOpenPath(args),
}));

afterEach(() => {
  cleanup();
  legoOpenPath.mockReset();
});

describe("ShowMe", () => {
  it("asks for the path it was given", async () => {
    legoOpenPath.mockResolvedValue({ opened: true });
    render(<ShowMe path="/games/some.sdd/objects3d/skyfort.s3o" />);

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));

    expect(legoOpenPath).toHaveBeenCalledWith({
      path: "/games/some.sdd/objects3d/skyfort.s3o",
    });
    await Promise.resolve();
    expect(screen.queryByText(/could not/)).toBeNull();
  });

  it("says why when the file manager could not be asked", async () => {
    legoOpenPath.mockRejectedValue(
      new Error("path does not exist: /games/gone.s3o"),
    );
    render(<ShowMe path="/games/gone.s3o" />);

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));

    expect(
      await screen.findByText("path does not exist: /games/gone.s3o"),
    ).toBeTruthy();
  });
});
