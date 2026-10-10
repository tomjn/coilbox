// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const { REPLAY_SOURCE_NOTES, REPLAY_SOURCES_DOC_URL } = await import(
  "../../replaySources"
);
const { ReplaySourceNote } = await import("./ReplaySourceNote");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReplaySourceNote", () => {
  it("says which source the section draws on", () => {
    render(<ReplaySourceNote source="stream" />);
    expect(screen.getByText(REPLAY_SOURCE_NOTES.stream)).toBeTruthy();
  });

  it("adds the section's own detail after the shared wording", () => {
    render(<ReplaySourceNote source="trailer" detail="Sampled every 15 s." />);
    expect(
      screen.getByText(`${REPLAY_SOURCE_NOTES.trailer} Sampled every 15 s.`),
    ).toBeTruthy();
  });

  it("opens the docs page in the system browser", () => {
    render(<ReplaySourceNote source="trailer" />);
    fireEvent.click(
      screen.getByRole("button", { name: /where these numbers come from/i }),
    );
    expect(openUrl).toHaveBeenCalledWith(REPLAY_SOURCES_DOC_URL);
  });

  it("names the source in words a player can read, and says orders for the stream", () => {
    expect(REPLAY_SOURCE_NOTES.stream).toMatch(/orders/);
    expect(REPLAY_SOURCE_NOTES.trailer).toMatch(/engine/);
    expect(REPLAY_SOURCE_NOTES.players).toContain(REPLAY_SOURCE_NOTES.setup);
  });
});
