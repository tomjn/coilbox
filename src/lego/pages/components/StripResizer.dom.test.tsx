// @vitest-environment happy-dom

/**
 * The drawer's drag handle, driven by the keyboard.
 *
 * happy-dom lays nothing out, so every element's `clientHeight` is 0 and the
 * handle would have nothing to clamp against. The column is given a height
 * here, which is the one thing about the real page this needs.
 *
 * The drag itself is not covered: it is pointer capture on a real element,
 * and what it computes is `clampPanelHeight`, which has its own tests.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it } from "vitest";

import {
  ASIDE_WIDTH,
  clampAsideWidth,
  clampDetailsHeight,
  DETAILS_HEIGHT,
  KEEP_VIEW,
  KEEP_VIEW_WIDTH,
  MIN_ASIDE_WIDTH,
  MIN_DETAILS_HEIGHT,
  MIN_TREE_HEIGHT,
  maxAsideWidth,
  maxDetailsHeight,
  STRIP_HEIGHT,
} from "../../panels";
import { StripResizer } from "./StripResizer";

afterEach(cleanup);

const COLUMN = 800;

function Harness({ start = STRIP_HEIGHT }: { start?: number }) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(start);
  return (
    <div
      ref={(node) => {
        if (node)
          Object.defineProperty(node, "clientHeight", { value: COLUMN });
        columnRef.current = node;
      }}
    >
      <output>{height}</output>
      <StripResizer
        height={height}
        onHeight={setHeight}
        columnRef={columnRef}
        controls="strip"
      />
    </div>
  );
}

function handle() {
  return screen.getByRole("separator", { name: "Resize this panel" });
}

it("grows the drawer on the up arrow and shrinks it on the down", () => {
  render(<Harness />);
  fireEvent.keyDown(handle(), { key: "ArrowUp" });
  expect(screen.getByRole("status").textContent).toBe(
    String(STRIP_HEIGHT + 24),
  );
  fireEvent.keyDown(handle(), { key: "ArrowDown" });
  fireEvent.keyDown(handle(), { key: "ArrowDown" });
  expect(screen.getByRole("status").textContent).toBe(
    String(STRIP_HEIGHT - 24),
  );
});

it("keeps some of the model view on End", () => {
  render(<Harness />);
  fireEvent.keyDown(handle(), { key: "End" });
  expect(screen.getByRole("status").textContent).toBe(
    String(COLUMN - KEEP_VIEW),
  );
});

it("brings a height stored in a taller window inside this one", () => {
  render(<Harness start={5_000} />);
  expect(screen.getByRole("status").textContent).toBe(
    String(COLUMN - KEEP_VIEW),
  );
});

it("reads its height out, so a screen reader follows the drag", () => {
  render(<Harness />);
  expect(handle().getAttribute("aria-valuenow")).toBe(String(STRIP_HEIGHT));
  expect(handle().getAttribute("aria-valuemax")).toBe(
    String(COLUMN - KEEP_VIEW),
  );
});

const ROW = 1600;

/** The side panel's handle, measuring a row 1600px wide. */
function SideHarness({ start = ASIDE_WIDTH }: { start?: number }) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(start);
  return (
    <div
      ref={(node) => {
        if (node) Object.defineProperty(node, "clientWidth", { value: ROW });
        rowRef.current = node;
      }}
    >
      <output>{width}</output>
      <StripResizer
        orientation="vertical"
        label="Resize the side panel"
        height={width}
        onHeight={setWidth}
        columnRef={rowRef}
        controls="aside"
        min={MIN_ASIDE_WIDTH}
        max={maxAsideWidth}
        clamp={clampAsideWidth}
      />
    </div>
  );
}

/** The details handle, measuring a column 800px tall. */
function DetailsHarness({ start = DETAILS_HEIGHT }: { start?: number }) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(start);
  return (
    <div
      ref={(node) => {
        if (node)
          Object.defineProperty(node, "clientHeight", { value: COLUMN });
        columnRef.current = node;
      }}
    >
      <output>{height}</output>
      <StripResizer
        label="Resize the details panel"
        height={height}
        onHeight={setHeight}
        columnRef={columnRef}
        controls="details"
        min={MIN_DETAILS_HEIGHT}
        max={maxDetailsHeight}
        clamp={clampDetailsHeight}
      />
    </div>
  );
}

const side = () =>
  screen.getByRole("separator", { name: "Resize the side panel" });
const details = () =>
  screen.getByRole("separator", { name: "Resize the details panel" });
const shown = () => screen.getByRole("status").textContent;

it("widens the side panel on the left arrow and narrows it on the right", () => {
  render(<SideHarness />);
  expect(side().getAttribute("aria-orientation")).toBe("vertical");
  fireEvent.keyDown(side(), { key: "ArrowLeft" });
  fireEvent.keyDown(side(), { key: "ArrowLeft" });
  expect(shown()).toBe(String(ASIDE_WIDTH + 48));
  fireEvent.keyDown(side(), { key: "ArrowRight" });
  expect(shown()).toBe(String(ASIDE_WIDTH + 24));
});

it("stops the side panel at its narrowest and at the view it leaves", () => {
  render(<SideHarness />);
  fireEvent.keyDown(side(), { key: "ArrowRight" });
  expect(shown()).toBe(String(MIN_ASIDE_WIDTH));
  fireEvent.keyDown(side(), { key: "End" });
  expect(shown()).toBe(String(ROW - KEEP_VIEW_WIDTH));
  fireEvent.keyDown(side(), { key: "Home" });
  expect(shown()).toBe(String(MIN_ASIDE_WIDTH));
});

it("brings a side panel width stored in a wider window inside this one", () => {
  render(<SideHarness start={5_000} />);
  expect(shown()).toBe(String(ROW - KEEP_VIEW_WIDTH));
  expect(side().getAttribute("aria-valuemax")).toBe(
    String(ROW - KEEP_VIEW_WIDTH),
  );
});

it("grows the details on the up arrow and shrinks them on the down", () => {
  render(<DetailsHarness />);
  expect(details().getAttribute("aria-orientation")).toBe("horizontal");
  fireEvent.keyDown(details(), { key: "ArrowUp" });
  expect(shown()).toBe(String(DETAILS_HEIGHT + 24));
  fireEvent.keyDown(details(), { key: "ArrowDown" });
  fireEvent.keyDown(details(), { key: "ArrowDown" });
  expect(shown()).toBe(String(DETAILS_HEIGHT - 24));
});

it("keeps the tree its minimum on End and the details theirs on Home", () => {
  render(<DetailsHarness />);
  fireEvent.keyDown(details(), { key: "End" });
  expect(shown()).toBe(String(COLUMN - MIN_TREE_HEIGHT));
  fireEvent.keyDown(details(), { key: "Home" });
  expect(shown()).toBe(String(MIN_DETAILS_HEIGHT));
});

it("brings details stored in a taller window inside this one", () => {
  render(<DetailsHarness start={5_000} />);
  expect(shown()).toBe(String(COLUMN - MIN_TREE_HEIGHT));
});
