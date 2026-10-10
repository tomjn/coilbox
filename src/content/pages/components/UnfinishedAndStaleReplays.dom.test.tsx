// @vitest-environment happy-dom
/**
 * Issues #3861 and #3868. An old remix says it will play on its original game
 * and offers the original only when it is in the library. Unfinished recordings
 * are previewed with the backend's own count before anything is deleted, and
 * only ever as unfinished.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayFile } from "../../bindings";

const deleteReplays = vi.fn();
vi.mock("@/notify/notify", () => ({ notify: vi.fn(async () => {}) }));
vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentDeleteReplays: (a: unknown) => deleteReplays(a),
  };
});

const { ClearUnfinishedButton } = await import("./ClearUnfinishedButton");
const { StaleRemixNotice } = await import("./StaleRemixNotice");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const replay = (name: string, sizeBytes: number): ReplayFile => ({
  filename: name,
  path: `/demos/${name}`,
  sizeBytes,
  modifiedMs: 0,
  unfinished: sizeBytes === 0,
});

describe("StaleRemixNotice", () => {
  it("names the game it plays and links to the original when it is there", () => {
    render(
      <MemoryRouter>
        <StaleRemixNotice
          gameType="Balanced Annihilation V15.9.8"
          sourceGametype="Beyond All Reason test-30018"
          originFilename="orig.sdfz"
          originInLibrary
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/will play on Beyond All Reason test-30018/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open the original replay" })
        .getAttribute("href"),
    ).toContain("orig.sdfz");
  });

  it("says it cannot be made again when the original is gone", () => {
    render(
      <MemoryRouter>
        <StaleRemixNotice
          gameType="A"
          sourceGametype="B"
          originFilename="orig.sdfz"
          originInLibrary={false}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/cannot be made again/)).toBeTruthy();
  });
});

describe("ClearUnfinishedButton", () => {
  it("is absent when no replay is empty", () => {
    const { container } = render(
      <ClearUnfinishedButton
        replays={[replay("a.sdfz", 10)]}
        onCleared={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("previews only the empty files, then deletes them as unfinished", async () => {
    deleteReplays.mockResolvedValue({
      summary: {
        applied: false,
        deleted: 2,
        bytes: 0,
        skipped: [],
        analyses: 0,
        analysisBytes: 0,
      },
    });
    const onCleared = vi.fn();
    render(
      <ClearUnfinishedButton
        replays={[
          replay("a.sdfz", 0),
          replay("b.sdfz", 10),
          replay("c.sdfz", 0),
        ]}
        onCleared={onCleared}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /clear unfinished/i }));
    await screen.findByText(/Delete 2 unfinished recordings\?/);
    expect(deleteReplays).toHaveBeenCalledWith({
      paths: ["/demos/a.sdfz", "/demos/c.sdfz"],
      apply: false,
      onlyUnfinished: true,
    });
    expect(
      screen.getByText(/Deleting that file loses the replay/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onCleared).toHaveBeenCalled());
    expect(deleteReplays).toHaveBeenLastCalledWith({
      paths: ["/demos/a.sdfz", "/demos/c.sdfz"],
      apply: true,
      onlyUnfinished: true,
    });
  });

  it("offers nothing to delete when every file was left alone", async () => {
    deleteReplays.mockResolvedValue({
      summary: {
        applied: false,
        deleted: 0,
        bytes: 0,
        skipped: [
          "a.sdfz: a game is running, and this empty file may be its recording",
        ],
        analyses: 0,
        analysisBytes: 0,
      },
    });
    render(
      <ClearUnfinishedButton
        replays={[replay("a.sdfz", 0)]}
        onCleared={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear unfinished/i }));
    await screen.findByText(/a game is running/);
    expect(
      (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
