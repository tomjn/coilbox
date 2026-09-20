// @vitest-environment happy-dom
/**
 * What the engine card says for each verdict. The download itself belongs to
 * `useResolveContent`, stood in for here, so this is about what the player is
 * told and offered.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineMatch } from "./engineMatch";

const resolve = vi.hoisted(() => ({
  canDownload: true,
  noWriteRoot: false,
  loading: false,
  download: vi.fn(),
}));
const completed = vi.hoisted(() => ({
  fire: (_item: { kind: string }) => {},
}));

vi.mock("@/content/useResolveContent", () => ({
  useResolveContent: () => ({
    loading: resolve.loading,
    noWriteRoot: resolve.noWriteRoot,
    canDownload: () => resolve.canDownload,
    download: resolve.download,
    statusFor: () => null,
    itemFor: () => null,
    errorFor: () => null,
  }),
}));
vi.mock("@/downloads/DownloadQueueProvider", () => ({
  useDownloadComplete: (cb: (item: { kind: string }) => void) => {
    completed.fire = cb;
  },
}));
vi.mock("@/downloads/pages/components/ProgressBar", () => ({
  QueueProgress: () => null,
}));

import { BattleEngineCard } from "./BattleEngineCard";

const match = (p: Partial<EngineMatch>): EngineMatch => ({
  verdict: "match",
  hostLabel: "spring 2026.09.01",
  mineLabel: "2026.09.01",
  ...p,
});

function card(m: EngineMatch, unreadable = false) {
  const onInstalled = vi.fn();
  render(
    <BattleEngineCard
      match={m}
      version="2026.09.01"
      target={null}
      onInstalled={onInstalled}
      unreadable={unreadable}
    />,
  );
  return onInstalled;
}

afterEach(() => {
  cleanup();
  resolve.canDownload = true;
  resolve.noWriteRoot = false;
  resolve.download.mockClear();
});

describe("BattleEngineCard", () => {
  it("names both engines and offers nothing when they match", () => {
    card(match({}));
    expect(screen.getByText("spring 2026.09.01")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the host's version as a download on a mismatch", () => {
    card(match({ verdict: "mismatch", mineLabel: "2025.06.20" }));
    fireEvent.click(screen.getByRole("button", { name: /2026\.09\.01/ }));
    expect(resolve.download).toHaveBeenCalledTimes(1);
  });

  it("says so when no download exists for this platform", () => {
    resolve.canDownload = false;
    card(match({ verdict: "mismatch", mineLabel: "2025.06.20" }));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/No download was found/)).toBeTruthy();
  });

  it("blames the download folder when that is what is missing", () => {
    resolve.canDownload = false;
    resolve.noWriteRoot = true;
    card(match({ verdict: "mismatch", mineLabel: "2025.06.20" }));
    expect(screen.getByText(/Set a download folder/)).toBeTruthy();
  });

  it("tells the room to look again once an engine has installed", () => {
    const onInstalled = card(match({ verdict: "mismatch" }));
    completed.fire({ kind: "game" });
    expect(onInstalled).not.toHaveBeenCalled();
    completed.fire({ kind: "engineRecoil" });
    expect(onInstalled).toHaveBeenCalledTimes(1);
  });

  it("says it is checking an engine that has not reported its version", () => {
    card(match({ verdict: "unverified", mineLabel: "some-folder" }));
    expect(screen.getByText(/Checking your engine/)).toBeTruthy();
  });

  it("says when the engine would not report its version", () => {
    card(match({ verdict: "unverified", mineLabel: "some-folder" }), true);
    expect(screen.getByText(/would not report its version/)).toBeTruthy();
  });
});
