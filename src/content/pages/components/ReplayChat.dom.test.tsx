// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "../../bindings";

let RESULT: { messages: ChatLine[]; incomplete: boolean } | Error;
vi.mock("../../bindings", () => ({
  contentDemoChat: async () => {
    if (RESULT instanceof Error) throw RESULT;
    return RESULT;
  },
}));

const { ReplayChat, chatTime } = await import("./ReplayChat");
const { REPLAY_SOURCE_NOTES } = await import("../../replaySources");

const line = (over: Partial<ChatLine>): ChatLine => ({
  frame: 0,
  time: 0,
  player: 0,
  text: "",
  system: false,
  ...over,
});

afterEach(cleanup);

function open(result: typeof RESULT) {
  RESULT = result;
  render(<ReplayChat replayPath="/replays/a.sdfz" durationSec={600} />);
}

/** Opens the log once the chat has been read. */
async function showLog() {
  const button = await screen.findByRole("button", { name: /show chat log/i });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(button);
}

describe("chatTime", () => {
  it("turns a frame into minutes and seconds at 30 frames a second", () => {
    expect(chatTime(0)).toBe("0:00");
    expect(chatTime(30 * 65)).toBe("1:05");
    expect(chatTime(30 * 65 + 29)).toBe("1:05");
  });

  it("labels a line from before the game started", () => {
    expect(chatTime(-1)).toBe("Pre-game");
  });
});

describe("ReplayChat", () => {
  it("shows time, sender and destination on each line", async () => {
    open({
      incomplete: false,
      messages: [
        line({
          frame: 30 * 65,
          player: 0,
          playerName: "Alice",
          dest: { kind: "everyone" },
          text: "gg",
        }),
        line({
          frame: 30 * 70,
          player: 1,
          playerName: "Bob",
          dest: { kind: "allies" },
          text: "push left",
        }),
        line({
          frame: 30 * 80,
          player: 0,
          playerName: "Alice",
          dest: { kind: "player", player: 1 },
          text: "psst",
        }),
        line({ frame: -1, player: 7, dest: { kind: "everyone" }, text: "hi" }),
        line({ frame: 30, player: 255, system: true, text: "Bob paused" }),
      ],
    });
    await showLog();
    expect(await screen.findByText("gg")).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.getByText("to allies")).toBeTruthy();
    expect(screen.getByText("to Bob")).toBeTruthy();
    expect(screen.getByText("Pre-game")).toBeTruthy();
    // A sender the replay never named gets its number, not a guess.
    expect(screen.getByText("Player 7")).toBeTruthy();
    expect(screen.getByText("*")).toBeTruthy();
  });

  it("notes an incomplete log", async () => {
    open({
      incomplete: true,
      messages: [line({ player: 0, playerName: "Alice", text: "gg" })],
    });
    await showLog();
    expect(await screen.findByText(/chat log may be incomplete/)).toBeTruthy();
    expect(screen.getByText(/timeline stops at the last line/)).toBeTruthy();
  });

  it("says plainly when the chat could not be read, without naming a tool", async () => {
    open(new Error("boom"));
    const msg = await screen.findByText(
      "The chat could not be read from this replay.",
    );
    expect(msg.textContent ?? "").not.toMatch(/demotool/i);
  });

  it("says when there was no chat", async () => {
    open({ incomplete: false, messages: [] });
    expect(await screen.findByText(/No chat was recorded/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show chat log/i })).toBeNull();
  });

  it("says the timeline and the log come from the recorded orders and messages", async () => {
    open({
      incomplete: false,
      messages: [line({ player: 0, playerName: "Alice", text: "gg" })],
    });
    await screen.findByRole("button", { name: /show chat log/i });
    // Neither section carries its source in the page. Each help does.
    expect(screen.queryByText(REPLAY_SOURCE_NOTES.stream)).toBeNull();
    for (const name of ["About the timeline", "About the chat log"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(
        within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByText(
          REPLAY_SOURCE_NOTES.stream,
        ),
      ).toBeTruthy();
    }
  });
});
