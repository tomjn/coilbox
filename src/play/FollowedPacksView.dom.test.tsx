// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowedPacksView } from "./FollowedPacksView";
import type { FollowedPack } from "./followedPacks";

afterEach(cleanup);

const pack: FollowedPack = {
  id: "pack-1",
  url: "https://raw.githubusercontent.com/o/r/main/pack.json",
  title: "Community pack",
  lastUpdatedAt: "2026-10-31T10:00:00.000Z",
  lastError: null,
  presets: [],
};

function renderView(packs: FollowedPack[], refused: string | null = null) {
  const followed = {
    packs,
    follow: vi.fn(async () => refused),
    refreshAll: vi.fn(async () => {}),
    unfollow: vi.fn(),
    markSeen: vi.fn(),
  };
  render(<FollowedPacksView followed={followed} />);
  return followed;
}

const address = () => screen.getByRole("textbox", { name: "Pack address" });

const submit = (value: string) => {
  fireEvent.change(address(), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Follow" }));
};

describe("FollowedPacksView", () => {
  it("follows the address typed and clears the box", async () => {
    const followed = renderView([]);
    submit(pack.url);
    await waitFor(() => expect(address()).toHaveProperty("value", ""));
    expect(followed.follow).toHaveBeenCalledWith(pack.url);
  });

  it("says why an address was refused and keeps it to correct", async () => {
    const message = "Coilbox does not follow packs from example.test.";
    renderView([], message);
    submit("https://example.test/p");
    expect(await screen.findByText(message)).toBeTruthy();
    expect(address()).toHaveProperty("value", "https://example.test/p");
  });

  it("offers no refresh with nothing followed", () => {
    renderView([]);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("refreshes from the button", async () => {
    const followed = renderView([pack]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(followed.refreshAll).toHaveBeenCalledTimes(1));
  });

  it("shows when a pack last updated, and why its last refresh failed", () => {
    renderView([{ ...pack, lastError: "Could not reach the host." }]);
    expect(screen.getByText(/^Last updated /)).toBeTruthy();
    expect(screen.getByText("Could not reach the host.")).toBeTruthy();
  });

  it("asks before unfollowing, then unfollows that pack", async () => {
    const followed = renderView([pack]);
    fireEvent.click(screen.getByRole("button", { name: "Unfollow" }));
    expect(followed.unfollow).not.toHaveBeenCalled();
    const confirm = await screen.findByText("Keep following");
    const row = confirm.parentElement as HTMLElement;
    fireEvent.click(
      row.querySelector("button:last-child") as HTMLButtonElement,
    );
    expect(followed.unfollow).toHaveBeenCalledWith("pack-1");
  });
});
