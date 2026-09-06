// @vitest-environment happy-dom

/**
 * The hub page's one visible way in to sharing something (issue #2562).
 *
 * Before this, "Share a pack" was its own header button and the four controls
 * for a player's maps and games lived only in Settings, reached from here by a
 * muted account link nobody would guess pointed there. This covers the menu
 * that replaces both: that it offers both actions, that a distribution which
 * switched pack sharing off loses only that item, and that each item opens the
 * drawer it is supposed to.
 */

import { DrawerHost, DrawerProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../profile/hidden", () => ({
  isProfileHidden: vi.fn(() => false),
}));

vi.mock("./ShareAssetsPanel", () => ({
  ShareAssetsPanel: ({ hubUrl }: { hubUrl: string }) => (
    <p>Sharing panel for {hubUrl}</p>
  ),
}));

vi.mock("../../../packs/pages/components/ExportPackForm", () => ({
  ExportPackForm: () => <p>Export pack form</p>,
}));

import { isProfileHidden } from "../../../profile/hidden";
import { ShareMenu } from "./ShareMenu";

function renderMenu(hubUrl = "https://hub.example") {
  return render(
    <DrawerProvider>
      <ShareMenu hubUrl={hubUrl} />
      <DrawerHost />
    </DrawerProvider>,
  );
}

// Radix opens the menu on pointerdown rather than click, to match native
// menu-button behaviour.
const openMenu = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: "Share" }), {
    button: 0,
  });

beforeEach(() => {
  vi.mocked(isProfileHidden).mockReturnValue(false);
});

afterEach(cleanup);

it("offers both a pack and a maps-and-games share", () => {
  renderMenu();
  openMenu();

  expect(screen.getByRole("menuitem", { name: /share a pack/i })).toBeTruthy();
  expect(
    screen.getByRole("menuitem", { name: /share your maps and games/i }),
  ).toBeTruthy();
});

it("drops the pack item when the profile has switched pack sharing off, and keeps the other", () => {
  vi.mocked(isProfileHidden).mockReturnValue(true);
  renderMenu();
  openMenu();

  expect(screen.queryByRole("menuitem", { name: /share a pack/i })).toBeNull();
  expect(
    screen.getByRole("menuitem", { name: /share your maps and games/i }),
  ).toBeTruthy();
});

it("opens the maps-and-games drawer, with the hub url handed to the menu", async () => {
  renderMenu("https://hub.example");
  openMenu();

  fireEvent.click(
    screen.getByRole("menuitem", { name: /share your maps and games/i }),
  );

  await screen.findByText("Sharing panel for https://hub.example");
});

it("opens the pack drawer", async () => {
  renderMenu();
  openMenu();

  fireEvent.click(screen.getByRole("menuitem", { name: /share a pack/i }));

  await screen.findByText("Export pack form");
});
