import { type CSSProperties, useLayoutEffect, useState } from "react";

/** A box in the window's pixels. */
export interface Frame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where a maximised 3D view goes when it should fill part of the window and not
 * all of it. Both are looked up when the view is maximised, so the elements need
 * only exist by then.
 */
export interface ExpandBounds {
  /** The area to fill: the page's content, between the app's own bars. */
  content: () => Element | null;
  /** Something at the bottom of that area to leave clear, such as a dock. The
   *  view stops at its top edge. */
  below?: () => Element | null;
}

/**
 * The content's box, cut off where `below` starts. `below` is clamped to the
 * content, so a dock that has scrolled out of view leaves the whole box.
 */
export function expandedFrame(content: Frame, below: Frame | null): Frame {
  const bottom = content.top + content.height;
  const stop = below
    ? Math.min(Math.max(below.top, content.top), bottom)
    : bottom;
  return {
    top: content.top,
    left: content.left,
    width: content.width,
    height: stop - content.top,
  };
}

const sameFrame = (a: Frame | null, b: Frame | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height);

const frameOf = (element: Element): Frame => {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
};

/**
 * The inline style that puts a maximised view over `bounds`, or undefined when
 * there are none or the content cannot be found, and the view fills the window.
 *
 * It follows the boxes while the view is maximised: the window resizing, and
 * the content or the element below it changing size, as a dock does when its
 * lanes are folded.
 */
export function useExpandedFrame(
  bounds: ExpandBounds | undefined,
  expanded: boolean,
): CSSProperties | undefined {
  const [frame, setFrame] = useState<Frame | null>(null);

  useLayoutEffect(() => {
    if (!expanded || !bounds) {
      setFrame(null);
      return;
    }
    const content = bounds.content();
    if (!content) {
      setFrame(null);
      return;
    }
    const below = bounds.below?.() ?? null;
    const measure = () => {
      const next = expandedFrame(
        frameOf(content),
        below ? frameOf(below) : null,
      );
      setFrame((last) => (sameFrame(last, next) ? last : next));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(content);
    if (below) observer?.observe(below);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [expanded, bounds]);

  return frame
    ? {
        top: frame.top,
        left: frame.left,
        width: frame.width,
        height: frame.height,
      }
    : undefined;
}
