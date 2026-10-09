// @vitest-environment happy-dom

/**
 * The build tree widgets load on demand (issue #3730), so a custom page that
 * names one must still draw it once the code arrives.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real embed pulls in three.js, the graph library and the unitsync hooks.
vi.mock("../content/pages/components/BuildTreeEmbed", () => ({
  BuildTreeEmbed: ({ arg, mode }: { arg?: string; mode: string }) => (
    <div data-testid="embed">{`${mode}:${arg}`}</div>
  ),
}));

vi.mock("../downloads/bindings", () => ({ dlInstalledContent: vi.fn() }));
vi.mock("../downloads/config", () => ({
  useContentRootPaths: () => [],
  useWriteRootPath: () => "",
}));
vi.mock("../downloads/pages/components/MapPacksBanner", () => ({
  MapPacksBanner: () => null,
}));
vi.mock("../content/pages/components/SetupCard", () => ({
  HomeSetupCard: () => null,
}));
vi.mock("./BrandedWelcome", () => ({ default: () => null }));

import { PageWidget } from "./widgets";

afterEach(cleanup);

describe("build tree widgets", () => {
  it.each([
    ["build-tree", "graph"],
    ["faction-button", "buttons"],
  ])("draws @widget/%s once its code has loaded", async (name, mode) => {
    render(<PageWidget name={name} arg="Some Game" />);
    const embed = await screen.findByTestId("embed");
    expect(embed.textContent).toBe(`${mode}:Some Game`);
  });
});
