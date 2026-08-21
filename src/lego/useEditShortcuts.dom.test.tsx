// @vitest-environment happy-dom

/**
 * The builder's editing shortcuts (issue #1844).
 *
 * `./shortcuts.test.ts` covers the table: which combination of keys is Cmd Z.
 * This is the handler that reads it, and the two ways it goes wrong are both
 * silent.
 *
 * The listener is registered once for the life of the page, so it has to reach
 * the handlers through something the next render rewrites. Bound to the
 * handlers it was created with, delete goes on deleting whatever was selected
 * when the unit opened, and nothing anywhere says so.
 *
 * And a key aimed at a text field is never a shortcut. Miss that and typing a
 * piece's name deletes pieces on the first backspace.
 */

import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type EditShortcuts, useEditShortcuts } from "./useEditShortcuts";

// Every mount here puts a listener on the window, so one left behind would
// answer the next test's keys as well as its own.
afterEach(() => {
  cleanup();
});

type Spy = ReturnType<typeof vi.fn<() => void>>;

/** Every handler as a spy, so a test can say which one ran and which did not. */
function spies(): Record<keyof EditShortcuts, Spy> {
  return {
    remove: vi.fn(() => {}),
    undo: vi.fn(() => {}),
    redo: vi.fn(() => {}),
    copy: vi.fn(() => {}),
    paste: vi.fn(() => {}),
    duplicate: vi.fn(() => {}),
    symmetry: vi.fn(() => {}),
  };
}

/** Which handlers ran, so an assertion can name all seven at once. */
function fired(handlers: Record<keyof EditShortcuts, Spy>): string[] {
  return Object.entries(handlers)
    .filter(([, spy]) => spy.mock.calls.length > 0)
    .map(([name]) => name);
}

/**
 * The hook, mounted, plus a text field and a rich-text area on the page for
 * the tests about typing.
 */
function mount(handlers: EditShortcuts) {
  function Harness({ on }: { on: EditShortcuts }) {
    useEditShortcuts(on);
    return (
      <div>
        <input aria-label="name" />
        <textarea aria-label="script" />
        {/* Stands in for a rich text field, which the builder's script editor
            is. Nothing here focuses it, so it needs no role of its own. */}
        <div contentEditable />
      </div>
    );
  }
  const view = render(<Harness on={handlers} />);
  return {
    rebind: (next: EditShortcuts) =>
      act(() => {
        view.rerender(<Harness on={next} />);
      }),
    /** The element the tests aim a key at, when it is not the page itself. */
    field: (label: string) => view.getByLabelText(label),
    editable: () =>
      view.container.querySelector("[contenteditable]") as Element,
    unmount: view.unmount,
  };
}

/**
 * A real keydown, from wherever it was aimed. Bubbling, because the listener
 * is on the window and every key in the builder starts somewhere below it.
 */
function press(
  key: string,
  options: {
    meta?: boolean;
    ctrl?: boolean;
    shift?: boolean;
    from?: EventTarget;
  } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: options.meta ?? false,
    ctrlKey: options.ctrl ?? false,
    shiftKey: options.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    (options.from ?? window).dispatchEvent(event);
  });
  return event;
}

describe("which key runs which handler", () => {
  it.each([
    ["z with the command key", "z", { meta: true }, "undo"],
    ["z with control", "z", { ctrl: true }, "undo"],
    ["shift z with the command key", "z", { meta: true, shift: true }, "redo"],
    ["y with the command key", "y", { meta: true }, "redo"],
    ["c with the command key", "c", { meta: true }, "copy"],
    ["v with the command key", "v", { meta: true }, "paste"],
    ["d with the command key", "d", { meta: true }, "duplicate"],
    ["m on its own", "m", {}, "symmetry"],
    ["backspace", "Backspace", {}, "remove"],
    ["delete", "Delete", {}, "remove"],
  ])("%s runs %s and nothing else", (_name, key, modifiers, expected) => {
    const handlers = spies();
    mount(handlers);
    press(key, modifiers);
    expect(fired(handlers)).toEqual([expected]);
  });

  it("leaves a key it has no shortcut for alone, and lets it through", () => {
    const handlers = spies();
    mount(handlers);
    const event = press("k");
    expect(fired(handlers)).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops the webview acting on a key it has taken", () => {
    // Backspace is the reason the handler exists at all: untouched, the webview
    // reads it as browser Back and the whole page leaves mid-edit.
    mount(spies());
    expect(press("Backspace").defaultPrevented).toBe(true);
    expect(press("z", { meta: true }).defaultPrevented).toBe(true);
  });

  it("does not read command m as symmetry", () => {
    // Cmd M is the window manager's, and the table says so with mod: false.
    const handlers = spies();
    mount(handlers);
    const event = press("m", { meta: true });
    expect(fired(handlers)).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("registers one listener, not one per render", () => {
    const handlers = spies();
    const view = mount(handlers);
    view.rebind(handlers);
    view.rebind(handlers);
    press("Backspace");
    expect(handlers.remove).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the builder is gone", () => {
    const handlers = spies();
    const view = mount(handlers);
    view.unmount();
    press("Backspace");
    expect(fired(handlers)).toEqual([]);
  });
});

describe("reaching the current handlers", () => {
  it("runs the handler from the latest render, not the first", () => {
    // The bug this guards: the listener is created once, so a handler captured
    // at that moment goes on acting on whatever was selected when the unit
    // opened. Nothing throws and nothing looks wrong - the wrong piece is
    // deleted.
    const deleted: string[] = [];
    const first = spies();
    const view = mount({ ...first, remove: () => deleted.push("hull") });

    const second = spies();
    view.rebind({ ...second, remove: () => deleted.push("leg") });
    press("Backspace");

    expect(deleted).toEqual(["leg"]);
  });

  it("keeps up across several renders and several shortcuts", () => {
    const seen: string[] = [];
    const view = mount({ ...spies(), duplicate: () => seen.push("first") });
    press("d", { meta: true });
    view.rebind({ ...spies(), duplicate: () => seen.push("second") });
    press("d", { meta: true });
    view.rebind({ ...spies(), duplicate: () => seen.push("third") });
    press("d", { meta: true });
    expect(seen).toEqual(["first", "second", "third"]);
  });
});

describe("keys aimed at a field", () => {
  it("leaves every shortcut alone while a text box has the key", () => {
    // Typing a piece's name in the panel must not delete pieces, and undo in a
    // text box is the browser's own.
    const handlers = spies();
    const view = mount(handlers);
    const input = view.field("name");
    for (const [key, modifiers] of [
      ["Backspace", {}],
      ["Delete", {}],
      ["m", {}],
      ["z", { meta: true }],
      ["c", { meta: true }],
      ["v", { meta: true }],
      ["d", { meta: true }],
    ] as const) {
      press(key, { ...modifiers, from: input });
    }
    expect(fired(handlers)).toEqual([]);
  });

  it("lets the field keep the key, rather than swallowing it", () => {
    const view = mount(spies());
    expect(
      press("Backspace", { from: view.field("name") }).defaultPrevented,
    ).toBe(false);
  });

  it("leaves a textarea alone too", () => {
    const handlers = spies();
    const view = mount(handlers);
    press("Backspace", { from: view.field("script") });
    press("z", { meta: true, from: view.field("script") });
    expect(fired(handlers)).toEqual([]);
  });

  it("leaves a rich text box alone too", () => {
    const handlers = spies();
    const view = mount(handlers);
    press("Backspace", { from: view.editable() });
    expect(fired(handlers)).toEqual([]);
  });

  it("still answers a key aimed anywhere else on the page", () => {
    // The guard is about the thing being typed into, not about the builder
    // having a field somewhere on it.
    const handlers = spies();
    const view = mount(handlers);
    press("Backspace", { from: view.editable().parentElement as EventTarget });
    expect(fired(handlers)).toEqual(["remove"]);
  });
});
