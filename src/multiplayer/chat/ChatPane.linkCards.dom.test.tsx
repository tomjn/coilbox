// @vitest-environment happy-dom

/**
 * The card under a chat message for a link (issues #284 and #5436): a YouTube
 * link gets its card from the link alone, any other link gets the card the hub
 * fetched, and both open the link.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { forgetLinkCards } from "@/hub/linkCard";
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
  useSetting: () => ["", () => {}],
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

const HUB_PICTURE = "https://hub.coilbox.org/api/v1/links/image?url=x&sig=y";
const fetchMock = vi.fn();

beforeEach(() => {
  openUrl.mockClear();
  forgetLinkCards();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ card: null })));
  vi.stubGlobal("fetch", fetchMock);
  // With no observer the card asks straight away rather than on scroll.
  vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

it("asks the hub nothing for a known site's link", () => {
  draw(`look ${YOUTUBE}`);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("draws a Giphy link's animation in place, from Giphy and not the hub, and opens the link", () => {
  const url = "https://giphy.com/gifs/funny-cat-3o7TKSjRrfIPjeiVyM";
  const { container } = draw(url);
  const card = container.querySelector<HTMLButtonElement>("[data-link-card]");
  const img = card?.querySelector("img");
  expect(img?.getAttribute("src")).toBe(
    "https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/200.webp",
  );
  expect(img?.getAttribute("alt")).toBe("GIPHY");
  expect(img?.className).toContain("max-h-[200px]");
  expect(fetchMock).not.toHaveBeenCalled();

  fireEvent.click(card as HTMLButtonElement);
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
});

it("shows a message that is only a Giphy link as the GIF alone, with no bubble", () => {
  const url = "https://giphy.com/gifs/3o7TKSjRrfIPjeiVyM";
  render(
    <ChatPane
      title="#main"
      messages={[{ ...said(url), at: 1 }]}
      onSend={() => {}}
    />,
  );
  expect(screen.queryByText(url)).toBeNull();
  expect(document.querySelector("[data-link-card] img")).not.toBeNull();
});

it("keeps the bubble when a Giphy link comes with other words", () => {
  const url = "https://giphy.com/gifs/3o7TKSjRrfIPjeiVyM";
  draw(`ha ${url}`);
  expect(screen.getByText(url)).toBeTruthy();
  expect(document.querySelector("[data-link-card] img")).not.toBeNull();
});

it("leaves a plain card that still opens the link when the animation fails to load", () => {
  const url = "https://giphy.com/gifs/3o7TKSjRrfIPjeiVyM";
  const { container } = draw(url);
  fireEvent.error(container.querySelector("img") as HTMLImageElement);
  const card = container.querySelector<HTMLButtonElement>("[data-link-card]");
  expect(card?.querySelector("img")).toBeNull();
  expect(card?.textContent).toContain("GIPHY");
  fireEvent.click(card as HTMLButtonElement);
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
});

it("shows no card for a link the hub has none for, which still opens from the message", async () => {
  const { container } = draw("see https://example.com/page");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(container.querySelector("[data-link-card]")).toBeNull();
  expect(container.querySelector("img")).toBeNull();

  fireEvent.click(screen.getByText("https://example.com/page"));
  expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://example.com/page");
});

it("shows the hub's card for any other link, with the picture from the hub", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        card: {
          url: "https://example.com/canonical",
          type: null,
          site_name: "Example",
          title: "A page about things",
          description: "What the page says about itself",
          image: HUB_PICTURE,
        },
      }),
    ),
  );
  const { container } = draw("see https://example.com/page#part");
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    "https://hub.coilbox.org/api/v1/links/card?url=https%3A%2F%2Fexample.com%2Fpage%23part",
    expect.anything(),
  );
  const card = await waitFor(() => {
    const found =
      container.querySelector<HTMLButtonElement>("[data-link-card]");
    expect(found).not.toBeNull();
    return found as HTMLButtonElement;
  });
  expect(card.textContent).toContain("Example");
  expect(card.textContent).toContain("A page about things");
  expect(card.textContent).toContain("What the page says about itself");
  expect(card.querySelector("img")?.getAttribute("src")).toBe(HUB_PICTURE);

  // The link opens as the sender typed it, not the hub's canonical address.
  fireEvent.click(card);
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(
    "https://example.com/page#part",
  );
});
