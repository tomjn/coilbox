import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The two boxes picoframe scrolls the app's content in are positioned (#4067).
 *
 * `sr-only` is `position: absolute`. An element like that with no positioned
 * ancestor is placed against `<body>`, at its spot in the box's full unscrolled
 * content, which can be far below the window. That made the document taller
 * than the window, and scrolling past the end of the pane moved the whole app
 * up (#4063).
 *
 * picoframe 0.10.0 made the settings pane and the content region `relative`, so
 * a stray absolute child is placed inside the box, scrolls with it and is
 * clipped by it. This reads the shipped markup rather than rendering it,
 * because the layout needs the whole frame around it and a layout engine to
 * show the difference. A release that drops `relative` fails here.
 */

const DIST = (path: string) =>
  readFileSync(
    fileURLToPath(
      new URL(
        `../../node_modules/@picoframe/frame/dist/${path}`,
        import.meta.url,
      ),
    ),
    "utf8",
  );

/** The class list of the element an anchor string introduces. */
function classOf(source: string, anchor: string): string {
  const from = source.indexOf(anchor);
  expect(from, `${anchor} is no longer in the shipped markup`).toBeGreaterThan(
    -1,
  );
  const tail = source.slice(from);
  return tail.match(/className:\s*"([^"]*)"/)?.[1] ?? "";
}

describe("picoframe's scrolling boxes are positioned", () => {
  it("makes the content region relative", () => {
    const className = classOf(
      DIST("layout/AppLayout.js"),
      '"data-slot": "content-scroll"',
    );
    expect(className.split(/\s+/)).toContain("relative");
  });

  it("makes the settings pane relative", () => {
    const source = DIST("pages/Settings.js");
    // The pane is the scrolling sibling of the settings nav.
    const pane = source.match(
      /className:\s*"([^"]*\boverflow-y-auto\b[^"]*\bp-8\b[^"]*)"/,
    )?.[1];
    expect(
      pane,
      "the settings pane is no longer found by its classes",
    ).toBeDefined();
    expect((pane ?? "").split(/\s+/)).toContain("relative");
  });
});
