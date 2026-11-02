// @vitest-environment happy-dom

/**
 * The card under a chat message for a link to a known site (issue #284): it
 * appears for a YouTube link, not for an ordinary one, and opens the link.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatMsg } from "../bindings";
import { ChatPane } from "./ChatPane";

const openUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

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

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function said(text: string): ChatMsg {
  return {
    channel: "main",
    from: "alice",
    text,
    kind: "said",
    at: 0,
    id: null,
  };
}

const draw = (text: string) =>
  render(<ChatPane title="#main" messages={[said(text)]} onSend={() => {}} />);

beforeEach(() => openUrl.mockClear());
afterEach(cleanup);

it("shows a card for a YouTube link, with its thumbnail, and opens the link", () => {
  const { container } = draw(`look ${YOUTUBE}`);
  const card = container.querySelector<HTMLButtonElement>("[data-link-card]");
  expect(card).not.toBeNull();
  expect(card?.textContent).toContain("YouTube");
  expect(card?.querySelector("img")?.getAttribute("src")).toBe(
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  expect(openUrl).not.toHaveBeenCalled();

  fireEvent.click(card as HTMLButtonElement);
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(YOUTUBE);
});

it("shows no card for an ordinary link, which still opens from the message", () => {
  const { container } = draw("see https://example.com/page");
  expect(container.querySelector("[data-link-card]")).toBeNull();
  expect(container.querySelector("img")).toBeNull();

  fireEvent.click(screen.getByText("https://example.com/page"));
  expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://example.com/page");
});
