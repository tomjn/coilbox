import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the detail header's row is allowed to do when it runs out of width.
 *
 * Read as source rather than rendered, because the header is part of a page
 * that needs a router and a Tauri backend to mount, and because vitest runs in
 * node where a rendered header has no width to run out of. So this holds the
 * class contract and nothing more: what those classes do at 600px was read off
 * the running app.
 *
 * The relationship is the whole of #1215. The actions are `shrink-0` and never
 * give up a pixel, so every pixel the window loses came out of the title, down
 * to a column one character wide. A row whose actions will not shrink has to be
 * allowed to wrap, and the title column has to say where it stops giving.
 */

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ReplayDetailPage.tsx"),
  "utf8",
);

/** Every `className` inside the page's `<header>`, in source order. */
function headerClasses(): string[] {
  const start = SOURCE.indexOf("<header");
  const end = SOURCE.indexOf("</header>");
  expect(start, "the page has no header").toBeGreaterThan(-1);
  expect(end, "the header never closes").toBeGreaterThan(start);
  return [...SOURCE.slice(start, end).matchAll(/className="([^"]+)"/g)].map(
    (m) => m[1],
  );
}

/** The header row itself, which is the first className in it. */
const row = () => headerClasses()[0];

/** The title, filename and warning column, which is the next one. */
const titleColumn = () => headerClasses()[1];

/** The action row, the only thing in the header that refuses to shrink. */
function actions(): string {
  const found = headerClasses().filter(
    (c) => c.includes("shrink-0") && c.includes("items-start"),
  );
  expect(found, "the action row is not there any more").toHaveLength(1);
  return found[0];
}

describe("the replay detail header", () => {
  it("wraps, because its actions will not shrink", () => {
    expect(actions()).toMatch(/(^| )shrink-0( |$)/);
    expect(row()).toMatch(/(^| )flex-wrap( |$)/);
  });

  it("gives the title a width it stops shrinking past", () => {
    // `min-w-0` truncates a long filename and is right for that. On its own it
    // also lets the column shrink to nothing.
    expect(titleColumn()).toMatch(/(^| )min-w-0( |$)/);
    expect(titleColumn()).toMatch(/(^| )basis-\d/);
    expect(titleColumn()).toMatch(/(^| )grow( |$)/);
  });

  it("lets the actions wrap among themselves once they are on their own line", () => {
    // Four buttons come to 487px and the app's smallest window leaves 512px.
    expect(actions()).toMatch(/(^| )flex-wrap( |$)/);
  });
});
