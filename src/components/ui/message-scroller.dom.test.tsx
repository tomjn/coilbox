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
import {
  distanceToBottom,
  frame,
  ITEM_HEIGHT,
  installMessageScrollerLayout,
  restoreMessageScrollerLayout,
} from "./messageScrollerLayoutStub";

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

beforeEach(installMessageScrollerLayout);
afterEach(restoreMessageScrollerLayout);

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

  it.each([
    "ArrowDown",
    "End",
    "PageDown",
    " ",
  ])("after %j pressed at the bottom, where it moves nothing", async (key) => {
    const { viewport, rerender } = await mountAtBottom();

    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
    await frame();

    rerender(<Thread count={9} />);
    await frame();

    expect(distanceToBottom(viewport)).toBe(0);
  });

  it("but not after ArrowUp scrolls the view up", async () => {
    const { viewport, rerender } = await mountAtBottom();

    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
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

describe("MessageScrollerViewport resumes following", () => {
  it("when the keyboard scrolls back to the bottom", async () => {
    const { viewport, rerender } = await mountAtBottom();

    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }),
      );
      viewport.scrollTop = 2 * ITEM_HEIGHT;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await frame();

    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
      viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await frame();

    rerender(<Thread count={9} />);
    await frame();

    expect(distanceToBottom(viewport)).toBe(0);
  });
});
