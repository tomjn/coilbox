// @vitest-environment happy-dom

/**
 * The member list's drag handle, driven by the keyboard.
 *
 * happy-dom lays nothing out, so every element's `clientWidth` is 0 and the
 * handle would have nothing to clamp against. The container is given a width
 * here, which is the one thing about the real page this needs.
 *
 * The drag itself is not covered: it is pointer capture on a real element,
 * and what it computes is `clampWidth`, which has its own tests.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "../bindings";
import { MemberList } from "./MemberList";
import { DEFAULT_WIDTH, KEY_STEP, maxWidth } from "./memberListWidth";

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

const PAGE = 1600;
const KEY = "multiplayer.memberListWidth";

function user(name: string): User {
  return {
    name,
    country: "",
    userId: "1",
    agent: "",
    status: { ingame: false, away: false, rank: 0, access: false, bot: false },
    rating: {},
  } as User;
}

function mount(width = PAGE) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: width });
  document.body.append(container);
  return render(<MemberList members={[user("a-very-long-username")]} />, {
    container,
  });
}

function handle() {
  return screen.getByRole("separator", { name: "Resize the member list" });
}

function drawnWidth() {
  return Number.parseInt(screen.getByRole("complementary").style.width, 10);
}

beforeEach(() => store.values.clear());
afterEach(cleanup);

it("is a vertical separator that reads its width out", () => {
  mount();
  expect(handle().getAttribute("aria-orientation")).toBe("vertical");
  expect(handle().getAttribute("aria-valuenow")).toBe(String(DEFAULT_WIDTH));
  expect(handle().getAttribute("aria-valuemax")).toBe(String(maxWidth(PAGE)));
  expect(handle().tabIndex).toBe(0);
});

it("widens on the left arrow and narrows on the right", () => {
  mount();
  fireEvent.keyDown(handle(), { key: "ArrowLeft" });
  fireEvent.keyDown(handle(), { key: "ArrowLeft" });
  expect(drawnWidth()).toBe(DEFAULT_WIDTH + 2 * KEY_STEP);
  fireEvent.keyDown(handle(), { key: "ArrowRight" });
  expect(drawnWidth()).toBe(DEFAULT_WIDTH + KEY_STEP);
  expect(store.values.get(KEY)).toBe(DEFAULT_WIDTH + KEY_STEP);
});

it("reads the stored width on mount", () => {
  store.values.set(KEY, 400);
  mount();
  expect(drawnWidth()).toBe(400);
  expect(handle().getAttribute("aria-valuenow")).toBe("400");
});

it("draws a stored width inside a smaller page without rewriting it", () => {
  store.values.set(KEY, 1200);
  mount(PAGE / 2);
  expect(drawnWidth()).toBe(maxWidth(PAGE / 2));
  expect(store.values.get(KEY)).toBe(1200);
});

it("goes back to the default on a double-click", () => {
  store.values.set(KEY, 400);
  mount();
  fireEvent.doubleClick(handle());
  expect(drawnWidth()).toBe(DEFAULT_WIDTH);
  expect(store.values.get(KEY)).toBe(DEFAULT_WIDTH);
});

it("shows a long username in full on hover", () => {
  mount();
  expect(screen.getByTitle("a-very-long-username").textContent).toBe(
    "a-very-long-username",
  );
});
