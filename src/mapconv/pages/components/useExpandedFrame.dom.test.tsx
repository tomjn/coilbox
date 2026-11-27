// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ExpandBounds,
  expandedFrame,
  type Frame,
  useExpandedFrame,
} from "./useExpandedFrame";

const content: Frame = { top: 40, left: 200, width: 800, height: 600 };

describe("expandedFrame", () => {
  it("stops at the top of the element below", () => {
    expect(
      expandedFrame(content, { top: 500, left: 200, width: 800, height: 140 }),
    ).toEqual({ top: 40, left: 200, width: 800, height: 460 });
  });

  it("fills the whole content when there is nothing below", () => {
    expect(expandedFrame(content, null)).toEqual(content);
  });

  it("does not run past the content when the element below is out of view", () => {
    expect(
      expandedFrame(content, { top: 900, left: 200, width: 800, height: 140 }),
    ).toEqual(content);
    expect(
      expandedFrame(content, { top: 0, left: 200, width: 800, height: 140 }),
    ).toEqual({ ...content, height: 0 });
  });
});

/** Boxes by element, which happy-dom does no layout to give. */
let boxes: Map<Element, Frame>;
let observed: Element[];
let resized: () => void;

beforeEach(() => {
  boxes = new Map();
  observed = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const f = boxes.get(this) ?? { top: 0, left: 0, width: 0, height: 0 };
      return {
        ...f,
        x: f.left,
        y: f.top,
        right: 0,
        bottom: 0,
        toJSON: () => ({}),
      };
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A page with a content area, a dock at its bottom and a view that can be
 *  maximised, as the replay page has them. */
function Page({ bounded = true }: { bounded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const bounds: ExpandBounds | undefined = bounded
    ? {
        content: () => document.querySelector("[data-content]"),
        below: () => document.querySelector("[data-dock]"),
      }
    : undefined;
  const style = useExpandedFrame(bounds, expanded);
  return (
    <div data-content>
      <div data-testid="view" style={style} data-expanded={expanded} />
      <button type="button" onClick={() => setExpanded((e) => !e)}>
        toggle
      </button>
      <div data-dock />
    </div>
  );
}

function place() {
  boxes.set(document.querySelector("[data-content]") as Element, content);
  boxes.set(document.querySelector("[data-dock]") as Element, {
    top: 500,
    left: 200,
    width: 800,
    height: 140,
  });
}

describe("useExpandedFrame", () => {
  it("gives no style until the view is maximised", () => {
    render(<Page />);
    place();
    expect(screen.getByTestId("view").getAttribute("style")).toBeNull();
  });

  it("fills the content above the dock when maximised, and lets go when restored", () => {
    render(<Page />);
    place();
    fireEvent.click(screen.getByText("toggle"));
    const view = screen.getByTestId("view");
    expect(view.style.top).toBe("40px");
    expect(view.style.left).toBe("200px");
    expect(view.style.width).toBe("800px");
    expect(view.style.height).toBe("460px");

    fireEvent.click(screen.getByText("toggle"));
    expect(view.getAttribute("style")).toBeNull();
  });

  it("follows the dock when its height changes", () => {
    render(<Page />);
    place();
    fireEvent.click(screen.getByText("toggle"));
    const dock = document.querySelector("[data-dock]") as Element;
    expect(observed).toContain(dock);

    boxes.set(dock, { top: 560, left: 200, width: 800, height: 80 });
    act(() => resized());
    expect(screen.getByTestId("view").style.height).toBe("520px");
  });

  it("follows the window when it is resized", () => {
    render(<Page />);
    place();
    fireEvent.click(screen.getByText("toggle"));
    boxes.set(document.querySelector("[data-content]") as Element, {
      ...content,
      width: 500,
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("view").style.width).toBe("500px");
  });

  it("gives no style without bounds, so the view fills the window", () => {
    render(<Page bounded={false} />);
    place();
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("view").getAttribute("style")).toBeNull();
  });
});
