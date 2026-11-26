// @vitest-environment happy-dom

/**
 * What the game-updates page says in each state the provider can be in. The
 * provider is mocked, so each case sets exactly the state it is about.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const RELEASE = { tag: "v2", name: "Release 2", body: "", assets: [] };
const BASE = {
  repo: "example/game",
  release: RELEASE as typeof RELEASE | null,
  checking: false,
  checkError: null as string | null,
  installError: null as string | null,
  updateAvailable: false,
  upToDate: false,
  installing: false,
  installed: false,
  profileUpdated: false,
  currentFile: null,
  download: null,
  runCheck: async () => {},
  install: async () => {},
  restart: async () => {},
};
const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const writeRoot = vi.hoisted(() => ({
  current: { path: "/games" as string | undefined, loading: false },
}));

vi.mock("../GameUpdatesProvider", () => ({
  useGameUpdates: () => state.current,
}));
vi.mock("../../downloads/config", () => ({
  useWriteRoot: () => writeRoot.current,
}));
vi.mock("../../downloads/pages/components/ProgressBar", () => ({
  QueueProgress: () => <div>progress</div>,
}));

import GameUpdatesSection from "./GameUpdatesSection";

function draw(over: Partial<typeof BASE>) {
  state.current = { ...BASE, ...over };
  render(
    <MemoryRouter>
      <GameUpdatesSection />
    </MemoryRouter>,
  );
}

const checkNow = () =>
  screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  writeRoot.current = { path: "/games", loading: false };
});

describe("the game-updates page", () => {
  it("says the game is up to date once the check and listing agree", () => {
    draw({ upToDate: true });
    expect(screen.getByText("Up to date with Release 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("does not claim up to date before the games folder has been read", () => {
    draw({ upToDate: false });
    expect(screen.queryByText(/Up to date/)).toBeNull();
    expect(screen.getByText("Latest release Release 2")).toBeTruthy();
  });

  it("shows a failed check without the earlier up to date result", () => {
    draw({ upToDate: true, checkError: "offline" });
    expect(screen.getByRole("alert").textContent).toBe("offline");
    expect(screen.queryByText(/Up to date/)).toBeNull();
  });

  it("shows an install failure on the update card, not on the check", () => {
    draw({ updateAvailable: true, installError: "disk full" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("disk full");
    expect(alert.closest("section")).toBeTruthy();
  });

  it("keeps the restart button after the install makes the game current", () => {
    // The install re-reads the games folder, which then has the release.
    draw({
      updateAvailable: false,
      upToDate: true,
      installed: true,
      profileUpdated: true,
    });
    expect(screen.getByRole("button", { name: "Restart now" })).toBeTruthy();
  });

  it("does not check again while an update downloads", () => {
    draw({ updateAvailable: true, installing: true });
    expect(checkNow().disabled).toBe(true);
    expect(screen.getByText("progress")).toBeTruthy();
  });

  it("asks for a download folder on the update card when there is none", () => {
    writeRoot.current = { path: undefined, loading: false };
    draw({ updateAvailable: true });
    expect(screen.getByRole("link", { name: "Content folders" })).toBeTruthy();
    const install = screen.getByRole("button", {
      name: "Download & install",
    }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
  });
});
