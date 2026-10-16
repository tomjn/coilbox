// @vitest-environment happy-dom

/**
 * The battle room's split handle, driven by the keyboard.
 *
 * happy-dom lays nothing out, so every element's height is 0. The column is
 * given a height here, which is the one thing about the real page this needs.
 * The drag is not covered: it is pointer capture on a real element, and what it
 * computes is `clampHeight`, which has its own tests.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ROOM_SPLIT_KEY, RoomSplitHandle, useRoomSplit } from "./RoomSplit";
import {
  CHAT_MIN_FALLBACK,
  GAP,
  KEY_STEP,
  maxHeight,
  TABLE_MIN,
} from "./splitLimits";

const store = vi.hoisted(() => ({ values: new Map<string, unknown>() }));

vi.mock("@picoframe/frame", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<typeof import("@picoframe/frame")>()),
    useSetting: <T,>(key: string, initial: T) => {
      const [value, setValue] = react.useState<T>(
        store.values.has(key) ? (store.values.get(key) as T) : initial,
      );
      return [
        value,
        (next: T) => {
          store.values.set(key, next);
          setValue(next);
        },
      ] as const;
    },
  };
});

const COLUMN = 1000;
const DRAWN = 300;

/**
 * `contents` gives the table a card holding one block of that height, which is
 * what the real table's contents measure. Without it the table is empty and the
 * contents are unmeasured.
 */
function Room({ contents }: { contents?: number }) {
  const split = useRoomSplit();
  return (
    <div ref={split.columnRef} data-testid="column">
      <div ref={split.tableRef} style={split.tableStyle} data-testid="table">
        {contents !== undefined && (
          <div data-testid="card">
            <div data-height={contents} />
          </div>
        )}
      </div>
      <RoomSplitHandle {...split.handle} />
      <div />
    </div>
  );
}

function mount(contents?: number) {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return { height: Number(this.getAttribute("data-height") ?? 0) };
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => COLUMN,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => DRAWN,
  });
  return render(<Room contents={contents} />);
}

function handle() {
  return screen.getByRole("separator");
}

function value() {
  return Number(handle().getAttribute("aria-valuenow"));
}

const MAX = maxHeight(COLUMN, CHAT_MIN_FALLBACK);

beforeEach(() => store.values.clear());
afterEach(cleanup);

it("is a horizontal separator that reads its height out", () => {
  mount();
  expect(handle().getAttribute("aria-orientation")).toBe("horizontal");
  expect(handle().getAttribute("aria-valuemin")).toBe(String(TABLE_MIN));
  expect(handle().getAttribute("aria-valuemax")).toBe(String(MAX));
  expect(handle().tabIndex).toBe(0);
  expect(MAX).toBe(COLUMN - GAP - CHAT_MIN_FALLBACK);
});

it("gives the table no height of its own until a split is stored", () => {
  mount();
  expect(screen.getByTestId("table").style.height).toBe("");
  expect(value()).toBe(DRAWN);
});

it("reads the stored height on mount", () => {
  store.values.set(ROOM_SPLIT_KEY, 400);
  mount();
  expect(screen.getByTestId("table").style.height).toBe("400px");
  expect(value()).toBe(400);
});

it("moves by one step per arrow press and stores the result", () => {
  store.values.set(ROOM_SPLIT_KEY, 400);
  mount();
  fireEvent.keyDown(handle(), { key: "ArrowDown" });
  expect(value()).toBe(400 + KEY_STEP);
  fireEvent.keyDown(handle(), { key: "ArrowUp" });
  fireEvent.keyDown(handle(), { key: "ArrowUp" });
  expect(value()).toBe(400 - KEY_STEP);
  expect(store.values.get(ROOM_SPLIT_KEY)).toBe(400 - KEY_STEP);
});

it("starts from the drawn height when nothing is stored", () => {
  mount();
  fireEvent.keyDown(handle(), { key: "ArrowDown" });
  expect(value()).toBe(DRAWN + KEY_STEP);
});

it("stops at both minimums", () => {
  store.values.set(ROOM_SPLIT_KEY, TABLE_MIN + 10);
  mount();
  fireEvent.keyDown(handle(), { key: "ArrowUp" });
  expect(value()).toBe(TABLE_MIN);
  fireEvent.keyDown(handle(), { key: "End" });
  expect(value()).toBe(MAX);
  fireEvent.keyDown(handle(), { key: "ArrowDown" });
  expect(value()).toBe(MAX);
});

it("draws a stored height inside a shorter column without rewriting it", () => {
  store.values.set(ROOM_SPLIT_KEY, 5000);
  mount();
  expect(value()).toBe(MAX);
  expect(store.values.get(ROOM_SPLIT_KEY)).toBe(5000);
});

it("goes back to the default on a double-click", () => {
  store.values.set(ROOM_SPLIT_KEY, 400);
  mount();
  fireEvent.doubleClick(handle());
  expect(screen.getByTestId("table").style.height).toBe("");
  expect(store.values.get(ROOM_SPLIT_KEY)).toBeNull();
});

it("stops the handle at the contents' height", () => {
  store.values.set(ROOM_SPLIT_KEY, 200);
  mount(260);
  expect(handle().getAttribute("aria-valuemax")).toBe("260");
  fireEvent.keyDown(handle(), { key: "End" });
  expect(value()).toBe(260);
  fireEvent.keyDown(handle(), { key: "ArrowDown" });
  expect(value()).toBe(260);
  expect(store.values.get(ROOM_SPLIT_KEY)).toBe(260);
});

it("draws a stored height taller than the contents at the contents' height without rewriting it", () => {
  store.values.set(ROOM_SPLIT_KEY, 700);
  mount(260);
  expect(screen.getByTestId("table").style.height).toBe("260px");
  expect(value()).toBe(260);
  expect(store.values.get(ROOM_SPLIT_KEY)).toBe(700);
});

it("follows the contents as they grow", async () => {
  store.values.set(ROOM_SPLIT_KEY, 700);
  mount(260);
  const block = screen.getByTestId("card").firstElementChild as HTMLElement;
  block.setAttribute("data-height", "340");
  // A new child is what a joining spectator adds, and is what triggers a measure here.
  screen.getByTestId("card").appendChild(document.createElement("div"));
  await waitFor(() => expect(value()).toBe(340));
  expect(handle().getAttribute("aria-valuemax")).toBe("340");
});
