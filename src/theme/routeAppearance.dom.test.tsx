// @vitest-environment happy-dom
import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { Link } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The frame listens for the OS mouse-nav buttons over Tauri's event bridge, which
// is not there under vitest. Nothing else in the frame reaches for the backend.
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const { AppFrame } = await import("@picoframe/frame");

/**
 * The conquest galaxy and the warpath map hold the dark ramp whatever theme the
 * player picked (#1809), and the thing that has to be true for that to be a fix
 * rather than a new bug is that it goes no further than those two routes.
 *
 * #1118 is why. A branded run wrote a colour somewhere durable and left it on
 * somebody's ordinary install. So the checks below are mostly about what does not
 * happen: no persisted key is written, and a player who chose light is back on
 * light the instant they leave the map.
 *
 * The mechanism is picoframe's `FrameRoute.appearance` (#1823). Coilbox used to
 * hand roll it, with a class on the element the page owned and a block in
 * `src/index.css` re-declaring picoframe's whole `@theme` colour set to make the
 * ordinary utilities follow. The frame does it at the document element now, which
 * is where Tailwind resolves those colours anyway, so all of that is gone.
 *
 * That moves what the middle phase looks like. The forcing used to be invisible
 * from up here, one class on one div. Now `dark` is on the document element while
 * the map is open, and the chrome around the map goes dark with it. What has not
 * moved is everything either side of it: the dataset, all three `picoframe.*`
 * keys, and the state the player is left in on the way out.
 *
 * The app under test is a real `AppFrame` and the navigation is a real link
 * click, for the reason the hand-rolled version's harness gave: a test that
 * re-mounted the shell per phase would let the theme provider's own mount effect
 * repair a leak on the way in and report a pass.
 */

/** The document state a leak would show up in. */
function documentState() {
  return {
    className: document.documentElement.className,
    dataset: { ...document.documentElement.dataset },
    theme: localStorage.getItem("picoframe.theme"),
    accent: localStorage.getItem("picoframe.accent"),
    base: localStorage.getItem("picoframe.base"),
    storedKeys: localStorage.length,
  };
}

/** A page with the two links every phase of these tests navigates by. */
function pageNamed(name: string): () => Promise<{ default: ComponentType }> {
  const Page = () => (
    <div>
      <p>{name}</p>
      <Link to="/ordinary">to ordinary</Link>
      <Link to="/map">to map</Link>
    </div>
  );
  return () => Promise.resolve({ default: Page });
}

/**
 * A stand-in for the two map routes, declared the way `src/conquest/index.ts` and
 * `src/runlite/index.ts` declare theirs. `hudChrome.test.ts` is what checks the
 * real pair still say this. The plugin here is so the app under test boots without
 * unitsync, a galaxy document or a saved run.
 */
const plugin: FramePlugin = {
  id: "test",
  version: "0.0.0",
  routes: [
    { path: "ordinary", lazy: pageNamed("ordinary"), crumb: "Ordinary" },
    {
      path: "map",
      lazy: pageNamed("map"),
      crumb: "Map",
      appearance: "dark",
    },
  ],
};

/** Put the player's saved theme in place before anything renders. */
function playerChose(mode: string, accent: string) {
  localStorage.setItem("picoframe.theme", JSON.stringify(mode));
  localStorage.setItem("picoframe.accent", JSON.stringify(accent));
}

/** The app open on an ordinary page, as the player left it. */
async function openApp() {
  const view = render(
    <AppFrame plugins={[plugin]} home={false} title="Test" />,
  );
  await screen.findByText("ordinary");
  return view;
}

/** Click through to a page, the way a player gets there. */
async function goTo(where: "ordinary" | "map") {
  await act(async () => {
    fireEvent.click(screen.getByText(`to ${where}`));
  });
  await screen.findByText(where);
}

// Vitest is not running with globals here, so testing-library's auto-cleanup is
// off. Without this a failing assertion leaves its container behind and every
// later test in the file reports a duplicate rather than its own result.
afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  for (const key of Object.keys(document.documentElement.dataset)) {
    delete document.documentElement.dataset[key];
  }
  window.location.hash = "#/ordinary";
});

describe("the map's dark ramp stays on the map", () => {
  for (const [mode, accent] of [
    ["light", "yellow"],
    ["dark", "blue"],
    ["light", "neutral"],
    ["dark", "neutral"],
  ] as const) {
    it(`leaves a ${mode}/${accent} player exactly where they were`, async () => {
      playerChose(mode, accent);

      // The baseline: the app open on an ordinary page.
      const view = await openApp();
      const before = documentState();

      // Navigating to the map. The whole window goes dark, chrome included, so
      // the top bar does not clash with a starfield. Nothing else moves, and
      // nothing durable moves at all.
      await goTo("map");
      const onMap = documentState();
      expect(onMap.className.split(" "), "on the map").toContain("dark");
      expect({ ...onMap, className: null }, "on the map").toEqual({
        ...before,
        className: null,
      });

      // Navigating away again. This is the moment #1118 went wrong: the colour
      // outlived the thing that asked for it.
      await goTo("ordinary");
      expect(documentState(), "back on an ordinary page").toEqual(before);

      view.unmount();
    });
  }

  it("leaves nothing stacked when the map is visited twice", async () => {
    playerChose("light", "violet");
    const view = await openApp();
    const before = documentState();

    for (let visit = 1; visit <= 2; visit++) {
      await goTo("map");
      await goTo("ordinary");
      expect(documentState(), `after visit ${visit}`).toEqual(before);
    }
    view.unmount();
  });

  it("never writes a theme the player did not choose", async () => {
    playerChose("light", "rose");
    const view = await openApp();
    await goTo("map");
    view.unmount();
    expect(localStorage.getItem("picoframe.theme")).toBe('"light"');
    expect(localStorage.getItem("picoframe.accent")).toBe('"rose"');
  });
});

describe("what the forcing is allowed to move", () => {
  it("says nothing to a dark player, who has nothing to force", async () => {
    playerChose("dark", "teal");
    const view = await openApp();
    const before = documentState();
    await goTo("map");
    expect(documentState()).toEqual(before);
    view.unmount();
  });

  it("keeps the accent the player chose, on the map as everywhere else", async () => {
    // The hand-rolled version had to copy the accent onto the element it
    // darkened, or a blue player got the neutral dark ramp on these two routes
    // and nowhere else. Forcing at the document element is forcing where the
    // accent already is, so there is nothing to copy.
    playerChose("light", "blue");
    const view = await openApp();
    await goTo("map");
    expect(document.documentElement.dataset.accent).toBe("blue");
    view.unmount();
  });

  it("leaves the ordinary routes on the player's theme", async () => {
    playerChose("light", "neutral");
    const view = await openApp();
    await goTo("map");
    await goTo("ordinary");
    expect(document.documentElement.className.split(" ")).not.toContain("dark");
    view.unmount();
  });
});
