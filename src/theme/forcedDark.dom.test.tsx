// @vitest-environment happy-dom
import { type Accent, type ThemeMode, ThemeProvider } from "@picoframe/frame";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useForcedDark } from "./forcedDark";

/**
 * The conquest galaxy and the warpath map hold the dark ramp whatever theme the
 * player picked (#1809), and the thing that has to be true for that to be a fix
 * rather than a new bug is that it goes no further than those two routes.
 *
 * #1118 is why. A branded run wrote a colour somewhere durable and left it on
 * somebody's ordinary install. So the checks below are mostly about what does not
 * happen: no persisted key is written, the document element is not touched, and a
 * player who chose light is still on light the instant the map unmounts.
 *
 * What makes the class reach the map in the first place is measured next door in
 * `forcedDark.test.ts`, which reads the stylesheet.
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

function Surface() {
  return <div data-testid="surface" {...useForcedDark("h-full")} />;
}

/**
 * The app as the player set it up, on an ordinary page or on the map.
 *
 * The provider is deliberately outside the switch, so mounting the map is a route
 * change inside a running app rather than a fresh boot. It matters: `ThemeProvider`
 * writes the player's class onto the document element in a mount effect, so a
 * harness that re-mounted the provider each time would quietly repair any leak the
 * map had just caused and report a pass.
 */
function app(withMap: boolean) {
  return <ThemeProvider>{withMap ? <Surface /> : <div />}</ThemeProvider>;
}

/** Put the player's saved theme in place before anything renders. */
function playerChose(mode: ThemeMode, accent: Accent) {
  localStorage.setItem("picoframe.theme", JSON.stringify(mode));
  localStorage.setItem("picoframe.accent", JSON.stringify(accent));
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
});

describe("the map's dark ramp stays on the map", () => {
  for (const [mode, accent] of [
    ["light", "yellow"],
    ["dark", "blue"],
    ["light", "neutral"],
    ["dark", "neutral"],
  ] as const) {
    it(`leaves a ${mode}/${accent} player exactly where they were`, () => {
      playerChose(mode, accent);

      // The baseline: the app open on an ordinary page.
      const view = render(app(false));
      const before = documentState();

      // Navigating to the map. Showing it must change nothing outside the
      // element the map owns.
      view.rerender(app(true));
      expect(documentState(), "on the map").toEqual(before);

      // Navigating away again. This is the moment #1118 went wrong: the colour
      // outlived the thing that asked for it.
      view.rerender(app(false));
      expect(documentState(), "back on an ordinary page").toEqual(before);

      // And closing the app on the map, which is the error-boundary teardown
      // shape as well.
      view.rerender(app(true));
      view.unmount();
      expect(documentState(), "after teardown").toEqual(before);
    });
  }

  it("leaves nothing stacked when two map routes are visited back to back", () => {
    playerChose("light", "violet");
    const view = render(app(false));
    const before = documentState();

    for (let visit = 1; visit <= 2; visit++) {
      view.rerender(app(true));
      view.rerender(app(false));
      expect(documentState(), `after visit ${visit}`).toEqual(before);
    }
    view.unmount();
  });

  it("never writes a theme the player did not choose", () => {
    playerChose("light", "rose");
    const view = render(app(true));
    view.unmount();
    expect(localStorage.getItem("picoframe.theme")).toBe('"light"');
    expect(localStorage.getItem("picoframe.accent")).toBe('"rose"');
  });
});

describe("what the map's own element carries", () => {
  it("takes the class picoframe's dark tokens and Tailwind's dark: variant both key on", () => {
    playerChose("light", "neutral");
    const { getByTestId, unmount } = render(app(true));
    expect(getByTestId("surface").className.split(" ")).toEqual(
      expect.arrayContaining(["dark", "forced-dark", "h-full"]),
    );
    unmount();
  });

  it("mirrors the accent, because an accent is declared on the same element as .dark", () => {
    // Without this a player who chose blue would get the neutral dark ramp here
    // and their accent everywhere else.
    playerChose("dark", "blue");
    const { getByTestId, unmount } = render(app(true));
    expect(getByTestId("surface").dataset.accent).toBe("blue");
    unmount();
  });

  it("leaves the default accent bare, the way ThemeProvider does", () => {
    playerChose("light", "neutral");
    const { getByTestId, unmount } = render(app(true));
    expect(getByTestId("surface").dataset.accent).toBeUndefined();
    unmount();
  });

  it("says the same thing to a dark player as to a light one", () => {
    // A dark player has nothing to force, so this has to be a description of a
    // state they are already in rather than a second, competing apply.
    playerChose("light", "teal");
    const light = render(app(true));
    const lightClass = light.getByTestId("surface").className;
    light.unmount();

    playerChose("dark", "teal");
    const dark = render(app(true));
    expect(dark.getByTestId("surface").className).toBe(lightClass);
    dark.unmount();
  });
});
