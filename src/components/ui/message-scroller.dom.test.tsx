// @vitest-environment happy-dom

/**
 * Regression tests for shadcn-ui/ui#11224 (issue #4200). With `autoScroll` on,
 * `@shadcn/react` stops following on any wheel or touchmove and only resumes
 * from a `scroll` event, so a gesture that moves nothing leaves the chat at the
 * bottom but no longer following. These mirror the two browser tests in
 * shadcn-ui/ui#11223. happy-dom has no layout, so the viewport's geometry is
 * stubbed from the number of messages: each is ITEM_HEIGHT tall.
 */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./message-scroller";

const ITEM_HEIGHT = 100;
const VIEWPORT_HEIGHT = 300;

function Thread({ count }: { count: number }) {
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            {Array.from({ length: count }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed test rows
              <MessageScrollerItem key={i} messageId={`m${i}`}>
                {`message ${i}`}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

const scrollTops = new WeakMap<Element, number>();
const proto = HTMLElement.prototype;
const original = {
  scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
  scrollTop: Object.getOwnPropertyDescriptor(proto, "scrollTop"),
  scrollTo: Object.getOwnPropertyDescriptor(proto, "scrollTo"),
  getBoundingClientRect: Object.getOwnPropertyDescriptor(
    proto,
    "getBoundingClientRect",
  ),
};

function isViewport(el: Element) {
  return el.getAttribute("data-slot") === "message-scroller-viewport";
}

beforeEach(() => {
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
        const viewport = this.closest("[data-slot=message-scroller-viewport]");
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
});

afterEach(() => {
  for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(proto, key, descriptor);
    else delete (proto as unknown as Record<string, unknown>)[key];
  }
});

function frame() {
  return act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function distanceToBottom(viewport: HTMLElement) {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
}

async function mountAtBottom() {
  const view = render(<Thread count={8} />);
  await frame();
  const viewport = view.container.querySelector<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  );
  if (!viewport) throw new Error("viewport missing");
  expect(distanceToBottom(viewport)).toBe(0);
  return { ...view, viewport };
}

describe("MessageScrollerViewport keeps following", () => {
  it("after a wheel toward the end at the bottom", async () => {
    const { viewport, rerender } = await mountAtBottom();

    act(() => {
      viewport.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: ITEM_HEIGHT }),
      );
    });
    await frame();

    rerender(<Thread count={9} />);
    await frame();

    expect(viewport.scrollHeight).toBe(9 * ITEM_HEIGHT);
    expect(distanceToBottom(viewport)).toBe(0);
  });

  it("after a touchmove that moves nothing", async () => {
    const { viewport, rerender } = await mountAtBottom();

    act(() => {
      viewport.dispatchEvent(new Event("touchmove", { bubbles: true }));
    });
    await frame();

    rerender(<Thread count={9} />);
    await frame();

    expect(viewport.scrollHeight).toBe(9 * ITEM_HEIGHT);
    expect(distanceToBottom(viewport)).toBe(0);
  });

  it("but still lets a real scroll away stop it", async () => {
    const { viewport, rerender } = await mountAtBottom();

    act(() => {
      viewport.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -ITEM_HEIGHT }),
      );
      viewport.scrollTop = 2 * ITEM_HEIGHT;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await frame();

    rerender(<Thread count={9} />);
    await frame();

    expect(viewport.scrollTop).toBe(2 * ITEM_HEIGHT);
  });
});
