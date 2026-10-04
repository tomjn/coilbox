// @vitest-environment happy-dom
/**
 * The hub item page asks the hub for the id in the route. `hubItemRoute` builds
 * that route with `encodeURIComponent` and the router decodes it once, so the
 * page must pass the parameter on as it comes. A second decode threw on a bare
 * `%` and asked for the wrong id for `%25` (#3422).
 */
import { cleanup, render } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const asked: string[] = [];

vi.mock("../api", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../api")),
  fetchHubItem: (_hub: string, id: string) => {
    asked.push(id);
    return new Promise(() => {});
  },
}));
vi.mock("../config", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../config")),
  useHubUrl: () => "https://hub.example",
}));
vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({ selected: null }),
  useUnitsyncMinimap: () => ({ startPositions: [] }),
}));
vi.mock("../imports", () => ({
  useHubItemPresence: () => () => ({ state: "none" }),
}));
vi.mock("../remove", () => ({ useHubRemoval: () => () => null }));

const { default: ItemPage } = await import("./ItemPage");
const { hubItemRoute } = await import("../config");

afterEach(() => {
  cleanup();
  window.location.hash = "";
  asked.length = 0;
});

const IDS = [
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

describe("hub ItemPage", () => {
  it.each(IDS)("asks the hub for %j", (id) => {
    window.location.hash = `#${hubItemRoute(id)}`;
    render(
      <HashRouter>
        <Routes>
          <Route path="/hub/:id" element={<ItemPage />} />
        </Routes>
      </HashRouter>,
    );
    expect(asked).toContain(id);
  });
});
