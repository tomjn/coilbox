/**
 * Layout stubs for tests that render a `MessageScroller` under happy-dom, which
 * has no layout. Each message (an element with `data-message-id`) is
 * ITEM_HEIGHT tall and the viewport is VIEWPORT_HEIGHT tall, so the viewport's
 * `scrollHeight`, `scrollTop` and the rect of each message follow from how many
 * messages there are. `scrollTo` and `scrollTop` writes are instant.
 */

import { act } from "@testing-library/react";

export const ITEM_HEIGHT = 100;
export const VIEWPORT_HEIGHT = 300;

const VIEWPORT = "[data-slot=message-scroller-viewport]";

const scrollTops = new WeakMap<Element, number>();
const proto = HTMLElement.prototype;
const KEYS = [
  "scrollHeight",
  "clientHeight",
  "scrollTop",
  "scrollTo",
  "getBoundingClientRect",
] as const;
let original: Record<string, PropertyDescriptor | undefined> = {};

function isViewport(el: Element) {
  return el.getAttribute("data-slot") === "message-scroller-viewport";
}

export function installMessageScrollerLayout() {
  original = Object.fromEntries(
    KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)]),
  );
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isViewport(this)
        ? (this.querySelectorAll("[data-message-id]").length || 0) * ITEM_HEIGHT
        : 0;
    },
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isViewport(this) ? VIEWPORT_HEIGHT : 0;
    },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      scrollTops.set(this, value);
    },
  });
  // The library measures content height from each message's rect.
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      let top = 0;
      let height = 0;
      if (isViewport(this)) {
        height = VIEWPORT_HEIGHT;
      } else if (this.hasAttribute("data-message-id")) {
        const viewport = this.closest(VIEWPORT);
        const index = Array.from(this.parentElement?.children ?? []).indexOf(
          this,
        );
        top = index * ITEM_HEIGHT - (viewport?.scrollTop ?? 0);
        height = ITEM_HEIGHT;
      }
      return new DOMRect(0, top, 100, height);
    },
  });
  Object.defineProperty(proto, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      scrollTops.set(this, options.top ?? 0);
    },
  });
}

export function restoreMessageScrollerLayout() {
  for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(proto, key, descriptor);
    else delete (proto as unknown as Record<string, unknown>)[key];
  }
}

/** Waits two animation frames, inside `act`, for the library's deferred work. */
export function frame() {
  return act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export function distanceToBottom(viewport: HTMLElement) {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
}
