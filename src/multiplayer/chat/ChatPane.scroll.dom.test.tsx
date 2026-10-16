// @vitest-environment happy-dom

/**
 * Whether the log follows new messages (issue #4199): it does while the reader
 * is at the bottom, it stays put once they scroll up, and sending always brings
 * it back to the bottom. happy-dom has no layout, so the viewport's geometry is
 * stubbed from the number of messages, as in message-scroller.dom.test.tsx.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  distanceToBottom,
  frame,
  ITEM_HEIGHT,
  installMessageScrollerLayout,
  restoreMessageScrollerLayout,
} from "@/components/ui/messageScrollerLayoutStub";
import type { ChatMsg } from "../bindings";
import { ChatPane } from "./ChatPane";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  useTheme: () => ({ resolved: "dark" }),
}));

const NOON = new Date(2026, 9, 7, 12, 0).getTime();

/** Alternating senders, so no two lines coalesce into one row. */
function said(count: number): ChatMsg[] {
  return Array.from({ length: count }, (_, i) => ({
    channel: "main",
    from: i % 2 === 0 ? "alice" : "bob",
    text: `line ${i}`,
    kind: "said",
    at: NOON + i * 60_000,
    id: null,
  }));
}

/** What a channel opens with: a join notice, then the talk. */
function withJoinFirst(count: number): ChatMsg[] {
  return [
    {
      channel: "main",
      from: "alice",
      text: "",
      kind: "join",
      at: NOON - 1,
      id: null,
    },
    ...said(count),
  ];
}

const ui = (messages: ChatMsg[], onSend: () => void = () => {}) => (
  <ChatPane title="#main" messages={messages} onSend={onSend} />
);

async function mountAtBottom(messages: ChatMsg[]) {
  const view = render(ui(messages));
  await frame();
  const viewport = view.container.querySelector<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  );
  if (!viewport) throw new Error("viewport missing");
  expect(distanceToBottom(viewport)).toBe(0);
  return { ...view, viewport };
}

/** The reader drags the view up to the top: a wheel, then the scroll it causes. */
function scrollUp(viewport: HTMLElement) {
  act(() => {
    viewport.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: -ITEM_HEIGHT }),
    );
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  return frame();
}

beforeEach(installMessageScrollerLayout);
afterEach(() => {
  cleanup();
  restoreMessageScrollerLayout();
});

describe("ChatPane follows new messages", () => {
  it("while the reader is at the bottom", async () => {
    const { viewport, rerender } = await mountAtBottom(said(8));

    rerender(ui(said(9)));
    await frame();

    expect(viewport.scrollHeight).toBe(9 * ITEM_HEIGHT);
    expect(distanceToBottom(viewport)).toBe(0);
  });

  it("when the first row is a notice and the day opens with a divider", async () => {
    const { viewport, rerender } = await mountAtBottom(withJoinFirst(8));

    rerender(ui(withJoinFirst(9)));
    await frame();

    rerender(ui(withJoinFirst(10)));
    await frame();

    expect(viewport.scrollHeight).toBe(11 * ITEM_HEIGHT);
    expect(distanceToBottom(viewport)).toBe(0);
  });

  it("when the first message arrives in an empty log", async () => {
    const view = render(ui([]));
    await frame();
    const { rerender } = view;
    const viewport = view.container.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    );
    if (!viewport) throw new Error("viewport missing");

    rerender(ui(said(1)));
    await frame();
    rerender(ui(said(8)));
    await frame();

    expect(distanceToBottom(viewport)).toBe(0);
  });

  it("when a line folds into the last row instead of adding one", async () => {
    const lines = said(8);
    const { viewport, rerender } = await mountAtBottom(lines);

    const merged = [
      ...lines.slice(0, -1),
      { ...lines[7], text: `${lines[7].text}\nand another line` },
    ];
    rerender(ui(merged));
    await frame();

    expect(distanceToBottom(viewport)).toBe(0);
  });
});

describe("ChatPane leaves the view alone", () => {
  it("once the reader has scrolled up", async () => {
    const { viewport, rerender } = await mountAtBottom(said(8));
    await scrollUp(viewport);

    rerender(ui(said(9)));
    await frame();

    expect(viewport.scrollTop).toBe(0);
    expect(distanceToBottom(viewport)).toBe(ITEM_HEIGHT * 9 - 300);
  });
});

describe("ChatPane sending", () => {
  async function send(text: string) {
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: text },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });
    await frame();
  }

  it("scrolls to the bottom when the reader had scrolled up", async () => {
    const onSend = vi.fn();
    const view = render(ui(said(8), onSend));
    await frame();
    const viewport = view.container.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    );
    if (!viewport) throw new Error("viewport missing");
    await scrollUp(viewport);
    expect(distanceToBottom(viewport)).toBeGreaterThan(0);

    await send("hello");
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(distanceToBottom(viewport)).toBe(0);

    // The echo of the message then follows, because sending resumed following.
    view.rerender(ui(said(9), onSend));
    await frame();
    expect(distanceToBottom(viewport)).toBe(0);
  });
});
