// @vitest-environment happy-dom
/**
 * Issue #4579: each library state draws a distinct Games card, with its own
 * badge, caption line and action.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIBRARY_GAMES_INPUT } from "../../fixtures/libraryGames";
import { buildLibrary, type LibraryGame } from "../../library";

vi.mock("../../branding", () => ({
  useBrandingEntry: () => null,
  useBrandingImage: () => undefined,
  useCachedImage: () => undefined,
}));
vi.mock("@/hub/config", () => ({ useTrustedHubUrl: () => null }));

import { GameCard } from "./GameCard";

afterEach(cleanup);

const { games } = buildLibrary(LIBRARY_GAMES_INPUT);
const byId = (id: string): LibraryGame => {
  const g = games.find((r) => r.id === id);
  if (!g) throw new Error(`no record for ${id}`);
  return g;
};

function renderCard(
  game: LibraryGame,
  extra: Partial<Parameters<typeof GameCard>[0]> = {},
) {
  const handlers = {
    onPlay: vi.fn(),
    onInstall: vi.fn(),
    onUpdate: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <MemoryRouter>
      <GameCard game={game} canDownload {...handlers} {...extra} />
    </MemoryRouter>,
  );
  return handlers;
}

const buttons = () =>
  screen.getAllByRole("button").map((b) => b.textContent?.trim());

describe("Games card per state", () => {
  it("installed: Installed badge, version and sources, Play", () => {
    const { onPlay } = renderCard(byId("ba"));
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.getByText("v15.9.8 · rapid")).toBeTruthy();
    expect(buttons()).toEqual(["Play"]);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlay).toHaveBeenCalledOnce();
    expect(screen.getByRole("link")).toBeTruthy();
  });

  it("update: the new version on the badge, Update and Play", () => {
    const { onUpdate } = renderCard(byId("sf"));
    expect(screen.getByText("Update 0.1.87")).toBeTruthy();
    expect(screen.getByText("v0.1.86 installed")).toBeTruthy();
    expect(buttons()).toEqual(["Update", "Play"]);
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("downloading: Downloading badge, a progress bar and Cancel", () => {
    const { onCancel } = renderCard(byId("zk"));
    expect(screen.getByText("Downloading")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(buttons()).toEqual(["Cancel"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("queued: Queued badge and Cancel, with no progress bar", () => {
    renderCard(byId("evo"));
    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(buttons()).toEqual(["Cancel"]);
  });

  it("available: no badge, the source kinds and Install", () => {
    const { onInstall } = renderCard(byId("mf"));
    expect(screen.getByText("rapid · github · springfiles")).toBeTruthy();
    expect(buttons()).toEqual(["Install"]);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledOnce();
    // Not installed, so there is no detail page to link to.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("local: Local badge, not on the hub, Play", () => {
    renderCard(byId("my test game"));
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.getByText("v1.0 · not on the hub")).toBeTruthy();
    expect(buttons()).toEqual(["Play"]);
  });

  it("no source: says so in the destructive colour and offers nothing", () => {
    renderCard(byId("ta"));
    const line = screen.getByText("no download source");
    expect(line.className).toContain("text-destructive");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("Games card actions", () => {
  it("disables Install with no download folder", () => {
    renderCard(byId("mf"), { canDownload: false });
    expect(
      (screen.getByRole("button", { name: "Install" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows why the last attempt failed", () => {
    renderCard(byId("mf"), { failure: "No usable download source" });
    expect(screen.getByText("No usable download source")).toBeTruthy();
  });

  it("disables Play on a list that has not been checked", () => {
    renderCard(byId("ba"), { playDisabled: true });
    expect(
      (screen.getByRole("button", { name: "Play" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
