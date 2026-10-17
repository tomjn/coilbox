/**
 * Where a canvas grid scrolls (#4468).
 *
 * The parts and module grids draw their cells on one canvas with a layer of
 * buttons over it. By default a grid scrolls itself: the canvas fills a box and
 * a scroller on top moves the buttons, which is what the builder's drawer
 * wants. Given a `scrollRoot`, a grid is as tall as its cells and scrolls with
 * that root instead, so the Lego Parts page can hold both grids under one
 * scroll bar. The canvas is then a sticky box no taller than the root, so only
 * the rows on screen are drawn either way.
 */

import { type RefObject, useEffect, useState } from "react";

/** The slice of a grid's cells the canvas shows, in grid pixels. */
export interface GridWindow {
  top: number;
  height: number;
}

export interface GridScroll {
  window: () => GridWindow;
  /** Scroll the least that brings this slice of the grid into view. */
  reveal: (top: number, height: number) => void;
  /** Back to the grid's first row, for a new filter. */
  reset: () => void;
  /** Call `draw` whenever the window may have moved. Returns the undo. */
  watch: (draw: () => void) => () => void;
}

/**
 * `content` is the element as tall as the grid's cells and `host` the one the
 * canvas fills. `own` is the grid's own scroller, used when `root` is
 * undefined. A `root` that is given but not mounted yet gives null.
 */
export function gridScroll(
  content: HTMLElement,
  host: HTMLElement,
  own: HTMLElement | null,
  root: HTMLElement | null | undefined,
): GridScroll | null {
  const page = root !== undefined;
  const scroller = page ? root : own;
  if (!scroller) return null;

  /** Where the grid starts within everything the scroller scrolls. */
  const offset = () =>
    page
      ? content.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop
      : 0;

  return {
    window: () =>
      page
        ? {
            // The sticky host has slid this far down the grid.
            top:
              host.getBoundingClientRect().top -
              content.getBoundingClientRect().top,
            height: host.clientHeight,
          }
        : { top: scroller.scrollTop, height: scroller.clientHeight },
    reveal: (top, height) => {
      const at = offset() + top;
      if (at < scroller.scrollTop) {
        scroller.scrollTop = at;
      } else if (at + height > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTop = at + height - scroller.clientHeight;
      }
    },
    reset: () => {
      scroller.scrollTop = Math.min(scroller.scrollTop, offset());
    },
    watch: (draw) => {
      scroller.addEventListener("scroll", draw, { passive: true });
      // On a page, a grid above this one growing or shrinking moves this one
      // without any scroll, so the page's contents are watched too.
      const observer = page ? new ResizeObserver(draw) : null;
      if (observer)
        for (const child of scroller.children) observer.observe(child);
      return () => {
        scroller.removeEventListener("scroll", draw);
        observer?.disconnect();
      };
    },
  };
}

/**
 * The root's height, kept current, or 0 with no root or none measured yet.
 *
 * A passive effect, not a layout one: the root is the grid's ancestor, and
 * React attaches an ancestor's ref only after its children's layout effects
 * have run. A grid waits for this before it builds its canvas.
 */
export function useRootHeight(root?: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = root?.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  return height;
}
