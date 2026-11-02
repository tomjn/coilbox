// @vitest-environment happy-dom

/**
 * The card under a chat message that links to a map (issue #286), in the real
 * ChatPane. The library, scan and download queue underneath it are stubbed,
 * because they need the app's Rust side.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mapFacts } from "../../content/fixtures/libraryMaps";
import type { LibraryMap } from "../../content/library";
import { buildMapLink } from "../../deeplink/build";
import { identityOf } from "../../downloads/DownloadQueueProvider";
import type { HeldMapAsset } from "../../hub/assets/picture";
import type { MapFacts } from "../../hub/maps/lookup";
import type { ChatMsg } from "../bindings";
import { ChatPane } from "./ChatPane";

const HUB = "https://coilbox-hub.vercel.app";

const hoisted = vi.hoisted(() => ({
  maps: [] as LibraryMap[],
  facts: null as MapFacts | null,
  held: null as unknown,
  filesRead: true,
  enqueue: vi.fn((_: unknown) => "id"),
  cancel: vi.fn(),
  items: [] as { id: string; identity: string; status: string }[],
  openUrl: vi.fn(() => Promise.resolve()),
  dispatch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: hoisted.openUrl }));
vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useTheme: () => ({ resolved: "dark" }),
  useSetting: () => ["", () => {}],
}));
vi.mock("../../deeplink/bus", () => ({ dispatchDeepLink: hoisted.dispatch }));
vi.mock("../../content/useLibrary", () => ({
  useLibrary: () => ({
    maps: hoisted.maps,
    filesRead: hoisted.filesRead,
    cataloguesRead: true,
  }),
}));
vi.mock("../../content/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../content/config")>()),
  useUnitsyncScan: () => ({
    data: { maps: [], games: [] },
    loading: false,
    error: null,
    cancelled: false,
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map(), loading: false }),
}));
vi.mock("../../play/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../play/config")>()),
  usePreferredTarget: () => ({
    target: { enginePath: "/e", dataDir: "/d" },
    loading: false,
  }),
}));
vi.mock("../../downloads/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../downloads/config")>()),
  useContentRoots: () => ({ paths: ["/d"], loading: false }),
  useWriteRootPath: () => "/d",
}));
vi.mock("../../downloads/DownloadQueueProvider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../downloads/DownloadQueueProvider")
  >()),
  useDownloadQueue: () => ({
    enqueue: hoisted.enqueue,
    cancel: hoisted.cancel,
    items: hoisted.items,
    waitFor: () => new Promise(() => {}),
    failureFor: () => null,
    completedFor: () => false,
  }),
}));
vi.mock("../../hub/maps/useMapFacts", () => ({
  useMapFacts: (name: string | undefined) => (name ? hoisted.facts : null),
}));
vi.mock("../../hub/assets/heldPictures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hub/assets/heldPictures")>()),
  heldMapAsset: () => hoisted.held,
  heldPicture: () => Promise.resolve(hoisted.held),
}));

const NAME = "Comet Catcher Redux v1.8";
const LINK = buildMapLink(NAME) as string;

function available(id: string): LibraryMap {
  return {
    id,
    state: "available",
    onDisk: false,
    sources: [
      { kind: "springfiles", filename: `${id}.sd7` },
    ] as LibraryMap["sources"],
  };
}

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

const mapCard = (container: HTMLElement) => {
  const found = container.querySelector<HTMLElement>("[data-map-card]");
  if (!found) throw new Error("no map card");
  return found;
};

beforeEach(() => {
  hoisted.maps = [available(NAME)];
  hoisted.facts = null;
  hoisted.held = null;
  hoisted.filesRead = true;
  hoisted.items = [];
  hoisted.enqueue.mockClear();
  hoisted.cancel.mockClear();
  hoisted.openUrl.mockClear();
  hoisted.dispatch.mockClear();
});
afterEach(cleanup);

it("shows a missing map with the hub's picture and details, and downloads it", async () => {
  hoisted.facts = {
    ...mapFacts(1),
    description: "A comet, caught",
    authors: [{ key: "a", name: "Mapper" }],
  };
  hoisted.held = {
    tier: "static",
    path: "minimaps/comet.webp",
    width: 512,
    height: 512,
  } satisfies HeldMapAsset;

  const { container } = draw(`look ${LINK}`);
  const card = within(mapCard(container));

  expect(card.getByText(NAME)).toBeTruthy();
  expect(card.getByText("Not installed")).toBeTruthy();
  expect(card.getByText("A comet, caught")).toBeTruthy();
  expect(card.getByText("By Mapper")).toBeTruthy();
  const img = await waitFor(() => {
    const found = mapCard(container).querySelector("img");
    if (!found) throw new Error("no picture yet");
    return found;
  });
  expect(img.getAttribute("src")).toContain("minimaps/comet.webp");
  expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
  // A button holding a button is invalid HTML, so the card is not a button.
  expect(mapCard(container).tagName).toBe("DIV");

  fireEvent.click(card.getByRole("button", { name: "Download" }));
  expect(hoisted.enqueue).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      kind: "mapAnySource",
      args: { mapName: NAME, writePath: "/d" },
    }),
  );
});

it("says an installed map is installed and offers no download", () => {
  hoisted.maps = [
    {
      id: NAME,
      state: "installed",
      onDisk: true,
      installed: { name: NAME, archives: [], info: {} },
      sources: [],
    },
  ];
  const { container } = draw(LINK);
  const card = within(mapCard(container));

  expect(card.getByText("Installed")).toBeTruthy();
  expect(card.queryByRole("button", { name: "Download" })).toBeNull();

  fireEvent.click(card.getByRole("button", { name: "Open" }));
  expect(hoisted.dispatch).toHaveBeenCalledExactlyOnceWith(LINK);
});

it("offers the download by name for a map the hub and the mirrors do not know", () => {
  hoisted.maps = [];
  const { container } = draw(LINK);
  const card = within(mapCard(container));

  expect(card.getByText("Not installed")).toBeTruthy();
  expect(mapCard(container).querySelector("img")).toBeNull();
  fireEvent.click(card.getByRole("button", { name: "Download" }));
  expect(hoisted.enqueue).toHaveBeenCalledOnce();
});

it("claims nothing about installation until the disk listing has been read", () => {
  hoisted.filesRead = false;
  const { container } = draw(LINK);
  const card = within(mapCard(container));

  expect(card.queryByText("Not installed")).toBeNull();
  expect(card.queryByRole("button", { name: "Download" })).toBeNull();
});

it("shows a running download with a way to cancel it", () => {
  hoisted.items = [
    {
      id: "q1",
      identity: identityOf({
        kind: "mapAnySource",
        label: NAME,
        args: { mapName: NAME, writePath: "/d" },
      }),
      status: "queued",
    },
  ];
  const { container } = draw(LINK);
  const card = within(mapCard(container));

  expect(card.getByText("Queued")).toBeTruthy();
  expect(card.queryByRole("button", { name: "Download" })).toBeNull();
  fireEvent.click(card.getByRole("button", { name: "Cancel" }));
  expect(hoisted.cancel).toHaveBeenCalledExactlyOnceWith("q1");
});

it("resolves a Beyond All Reason link to the newest version and asks BAR for nothing", () => {
  hoisted.maps = [
    available("Supreme Isthmus v2"),
    available("Supreme Isthmus v10"),
  ];
  const url = "https://www.beyondallreason.info/map/supreme-isthmus";
  const { container } = draw(url);
  const card = within(mapCard(container));

  expect(card.getByText("Supreme Isthmus v10")).toBeTruthy();
  expect(card.getByText("Beyond All Reason")).toBeTruthy();
  expect(mapCard(container).querySelector("img")).toBeNull();

  fireEvent.click(card.getByRole("button", { name: "Open link" }));
  expect(hoisted.openUrl).toHaveBeenCalledExactlyOnceWith(url);
});

it("names the slug and opens the page when a hub link matches no known map", () => {
  hoisted.maps = [];
  const url = `${HUB}/map/never-heard-of-it`;
  const { container } = draw(url);
  const card = within(mapCard(container));

  expect(card.getByText("never-heard-of-it")).toBeTruthy();
  expect(card.queryByRole("button", { name: "Download" })).toBeNull();
  expect(screen.getAllByText(url).length).toBeGreaterThan(0);
  fireEvent.click(card.getByRole("button", { name: "Open link" }));
  expect(hoisted.openUrl).toHaveBeenCalledExactlyOnceWith(url);
});
