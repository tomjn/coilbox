// @vitest-environment happy-dom
/**
 * A boundary put round one part of a page, rather than round the app.
 *
 * The app-wide boundary answers a throw by taking the window, which is right
 * when the thing that threw is the screen. Round a 3D map on a page of forms it
 * is wrong: a scene that will not draw took the triggers, the objectives and the
 * setup with it and left no way to reach the document at all.
 *
 * So a `fallback` is what the boundary shows instead, and what is asserted here
 * is that the rest of the tree is still standing beside it.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// Tauri's app plugin is reached in componentDidCatch for the version the report
// carries. Nothing here reads the report, and an unmocked call rejects.
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: () => Promise.resolve(),
}));

afterEach(cleanup);

function Boom(): never {
  throw new Error("the scene would not draw");
}

describe("a boundary round part of a page", () => {
  it("shows the fallback where the broken part was, and nothing else changes", () => {
    // React logs the caught error, which is noise rather than a failure here.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <p>The triggers panel</p>
        <ErrorBoundary fallback={<p>The map could not be drawn.</p>}>
          <Boom />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText("The map could not be drawn.")).toBeTruthy();
    // The whole point: the page around it is untouched.
    expect(screen.getByText("The triggers panel")).toBeTruthy();
    // And the window is not taken by the app-wide report.
    expect(screen.queryByText("Something went wrong")).toBeNull();
    quiet.mockRestore();
  });

  it("still takes the window when no fallback is given, which is what the app-wide one does", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    quiet.mockRestore();
  });

  it("leaves a tree that does not throw exactly as it was", () => {
    render(
      <ErrorBoundary fallback={<p>The map could not be drawn.</p>}>
        <p>The map</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("The map")).toBeTruthy();
    expect(screen.queryByText("The map could not be drawn.")).toBeNull();
  });
});
