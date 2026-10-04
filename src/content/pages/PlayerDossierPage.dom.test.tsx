// @vitest-environment happy-dom
/**
 * The player dossier reads the player's name from the route. The replay page
 * links to it with `encodeURIComponent` and the router decodes it once, so the
 * page must show the parameter as it comes. A second decode threw on a bare
 * `%` and showed the wrong name for `%25` (#3422).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("../config", () => ({
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({ records: [], ingesting: false, error: null }),
  useScanTargetSelection: () => ({ selected: null }),
}));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({ state: null }),
  refightFilenames: () => [],
}));

const { default: PlayerDossierPage } = await import("./PlayerDossierPage");

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const NAMES = [
  "%",
  "%25",
  "50% done",
  "a#b",
  "a?b",
  "a/b",
  "a b",
  "a+b",
  "Ünïcode 名前",
];

describe("PlayerDossierPage", () => {
  it.each(NAMES)("names a player called %j", (name) => {
    // The path the replay page's roster links build.
    window.location.hash = `#/stats/${encodeURIComponent(name)}`;
    render(
      <HashRouter>
        <Routes>
          <Route path="/stats/:name" element={<PlayerDossierPage />} />
        </Routes>
      </HashRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name);
  });
});
