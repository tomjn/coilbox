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

import { KEEP_VIEW, STRIP_HEIGHT } from "../../panels";
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
