// @vitest-environment happy-dom

/**
 * The suggestion cards' art. The branding image hook is stubbed, so each test
 * says whether the picture is still being fetched and what it resolved to.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SuggestedGame } from "@/content/branding";

let image: { src?: string; loading: boolean } = { loading: false };
vi.mock("@/content/branding", async (original) => ({
  ...(await original<typeof import("@/content/branding")>()),
  useBrandingCatalog: () => [],
  useGithubGameRepos: () => [],
  useBrandingImageState: () => image,
}));

vi.mock("@/downloads/DownloadQueueProvider", async (original) => ({
  ...(await original<typeof import("@/downloads/DownloadQueueProvider")>()),
  useDownloadQueue: () => ({
    enqueue: () => "q1",
    waitFor: () => new Promise(() => {}),
    items: [],
    settled: [],
    failureFor: () => null,
    completedFor: () => false,
  }),
}));

const { SuggestionsList } = await import("./SuggestionsList");

const SF: SuggestedGame = {
  id: "sf",
  title: "Splinter Faction",
  banner: ["https://example.com/sf.jpg"],
  download: { kind: "rapid", tag: "sf:test" },
};

function show() {
  return render(
    <SuggestionsList
      kind="game"
      items={[SF]}
      writeRoot={{ path: "/data", loading: false }}
    />,
  );
}

const skeleton = () => document.querySelector("[data-slot=skeleton]");
const art = () => document.querySelector("img");

beforeEach(() => {
  image = { loading: false };
});

afterEach(cleanup);

it("shows a loading state while the art is fetched", () => {
  image = { loading: true };
  show();
  expect(skeleton()).toBeTruthy();
  expect(art()).toBeNull();
});

it("keeps the loading state until the picture has loaded", () => {
  image = { src: "sf.jpg", loading: false };
  show();
  expect(skeleton()).toBeTruthy();
  const img = art() as HTMLImageElement;
  fireEvent.load(img);
  expect(skeleton()).toBeNull();
  expect(art()?.getAttribute("src")).toBe("sf.jpg");
});

it("falls back to the plain box when the picture fails to load", () => {
  image = { src: "sf.jpg", loading: false };
  show();
  fireEvent.error(art() as HTMLImageElement);
  expect(skeleton()).toBeNull();
  expect(art()).toBeNull();
});

it("shows the plain box when there is no art", () => {
  show();
  expect(skeleton()).toBeNull();
  expect(art()).toBeNull();
  expect(screen.getByText("Splinter Faction")).toBeTruthy();
});

it("starts the cards at the left unless asked to centre them", () => {
  const view = show();
  expect(screen.getByRole("list").className).not.toContain("justify-center");
  view.rerender(
    <SuggestionsList
      kind="game"
      items={[SF]}
      writeRoot={{ path: "/data", loading: false }}
      centred
    />,
  );
  expect(screen.getByRole("list").className).toContain("justify-center");
});
