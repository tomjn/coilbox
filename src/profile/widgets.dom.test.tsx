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
  MapPacksBanner: ({ installed }: { installed: Set<string> }) => (
    <div data-testid="packs">{[...installed].join(",")}</div>
  ),
}));
const library = vi.hoisted(() => ({
  filesRead: false,
  maps: new Set<string>(),
}));
vi.mock("../content/useLibrary", () => ({
  useLibrary: () => ({
    installedFiles: { maps: library.maps, games: new Set() },
    filesRead: library.filesRead,
  }),
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

describe("map pack widget", () => {
  it("draws nothing before the disk listing lands", () => {
    library.filesRead = false;
    library.maps = new Set();
    render(<PageWidget name="map-pack" />);
    expect(screen.queryByTestId("packs")).toBeNull();
  });

  it("hands the banner the library's installed maps", () => {
    library.filesRead = true;
    library.maps = new Set(["throne_v8.sd7"]);
    render(<PageWidget name="map-pack" />);
    expect(screen.getByTestId("packs").textContent).toBe("throne_v8.sd7");
  });
});
