// @vitest-environment happy-dom

/**
 * How a grid scrolls with a page rather than in a box of its own (#4468).
 * happy-dom lays nothing out, so each element's place on screen is given here.
 */

import { describe, expect, it } from "vitest";

import { gridScroll } from "./gridScroll";

/** An element at `top` on screen, `height` tall. */
function at(top: () => number, height = 0): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => ({ top: top() }) as DOMRect;
  Object.defineProperty(element, "clientHeight", { value: height });
  return element;
}

/**
 * A page 400 tall, scrolled `scrollTop` down, with a grid that starts 300 down
 * its contents and a sticky canvas 400 tall that has slid `slid` down the grid.
 */
function page(scrollTop: number, slid: number) {
  const root = at(() => 0, 400);
  root.scrollTop = scrollTop;
  const content = at(() => 300 - root.scrollTop);
  const host = at(() => 300 - root.scrollTop + slid, 400);
  return { root, scroll: gridScroll(content, host, null, root) };
}

describe("a grid on a page", () => {
  it("shows the slice of the grid its sticky canvas has slid to", () => {
    expect(page(500, 200).scroll?.window()).toEqual({ top: 200, height: 400 });
  });

  it("scrolls the page by where the grid starts to reveal a row", () => {
    const { root, scroll } = page(0, 0);
    // Grid row at 200 is page 500, 72 tall, so the page's bottom edge moves
    // to 572.
    scroll?.reveal(200, 72);
    expect(root.scrollTop).toBe(172);
    scroll?.reveal(0, 72);
    expect(root.scrollTop).toBe(172);
  });

  it("goes back to the grid's top for a new filter, and no further", () => {
    const deep = page(900, 600);
    deep.scroll?.reset();
    expect(deep.root.scrollTop).toBe(300);
    const shallow = page(100, 0);
    shallow.scroll?.reset();
    expect(shallow.root.scrollTop).toBe(100);
  });

  it("waits for a page that has not mounted", () => {
    expect(
      gridScroll(
        at(() => 0),
        at(() => 0),
        null,
        null,
      ),
    ).toBeNull();
  });
});

describe("a grid in its own box", () => {
  it("scrolls its own scroller, from the top", () => {
    const own = at(() => 0, 400);
    own.scrollTop = 160;
    const scroll = gridScroll(
      at(() => 0),
      at(() => 0),
      own,
      undefined,
    );
    expect(scroll?.window()).toEqual({ top: 160, height: 400 });
    scroll?.reset();
    expect(own.scrollTop).toBe(0);
  });
});
