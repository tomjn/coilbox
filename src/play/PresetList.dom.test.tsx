// @vitest-environment happy-dom

/**
 * A preset's row shows the best result recorded against it, links to the replay
 * while that replay is still on disk, and clears the record behind a confirm.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// `presets.ts` pulls in the frame package, whose `AppFrame` subpath does not
// resolve under vitest's node resolver.
vi.mock("@picoframe/frame", async () => {
  const { forwardRef } = await import("react");
  return {
    useSetting: vi.fn(),
    Button: forwardRef<HTMLButtonElement, Record<string, unknown>>(
      ({ variant: _v, size: _s, ...props }, ref) => (
        <button ref={ref} type="button" {...props} />
      ),
    ),
  };
});

import type { ResultRecord } from "../records/bestResult";
import { PresetList } from "./PresetList";
import type { Participant } from "./participants";
import { presetRecordKey } from "./presetRecord";
import type { SkirmishPreset } from "./presets";

afterEach(cleanup);

const you: Participant = {
  id: "p0",
  kind: "you",
  name: "You",
  side: "arm",
  color: [0.5, 0.5, 0.5],
  allyTeam: 0,
  spectator: false,
};

const preset: SkirmishPreset = {
  id: "preset-1",
  name: "Hard one",
  createdAt: "",
  lastUsedAt: "",
  participants: [you],
  gameName: "Some Game",
  mapName: "Some Map",
  startPosType: 0,
  modOptionValues: {},
};

const won: ResultRecord = {
  attempts: 5,
  wins: 2,
  best: { durationSec: 754, replayFilename: "best.sdfz" },
  seen: ["best.sdfz"],
};

function renderList(over: Partial<Parameters<typeof PresetList>[0]> = {}) {
  const onClearRecord = vi.fn();
  render(
    <MemoryRouter>
      <PresetList
        presets={[preset]}
        thumbs={new Map()}
        onOpen={vi.fn()}
        empty="none"
        records={{ [presetRecordKey(preset)]: won }}
        replayExists={() => true}
        onClearRecord={onClearRecord}
        {...over}
      />
    </MemoryRouter>,
  );
  return { onClearRecord };
}

describe("PresetList records", () => {
  it("shows the best win and the attempt count on the row", () => {
    renderList();
    expect(
      screen.getByText("Best win 12:34 · 2 wins in 5 attempts"),
    ).toBeTruthy();
  });

  it("shows attempts and no best time for a preset with only losses", () => {
    renderList({
      records: {
        [presetRecordKey(preset)]: {
          attempts: 3,
          wins: 0,
          best: null,
          seen: [],
        },
      },
    });
    expect(screen.getByText("3 attempts, no wins")).toBeTruthy();
    expect(screen.queryByText(/Best win/)).toBeNull();
  });

  it("shows nothing for a preset with no record", () => {
    renderList({ records: {} });
    expect(screen.queryByText(/attempt/)).toBeNull();
    expect(screen.queryByLabelText(/Clear the record/)).toBeNull();
    expect(screen.queryByLabelText(/Watch the best/)).toBeNull();
  });

  it("links to the replay while it exists", () => {
    renderList();
    const link = screen.getByLabelText(
      "Watch the best replay for Hard one",
    ) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/play/replays/best.sdfz");
  });

  it("keeps the result but drops the link once the replay is gone", () => {
    renderList({ replayExists: () => false });
    expect(screen.getByText(/Best win 12:34/)).toBeTruthy();
    expect(screen.queryByLabelText(/Watch the best/)).toBeNull();
  });

  it("clears the record only after the confirm", () => {
    const { onClearRecord } = renderList();
    fireEvent.click(screen.getByLabelText("Clear the record for Hard one"));
    expect(onClearRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear record" }));
    expect(onClearRecord).toHaveBeenCalledWith(preset);
  });

  it("does not clear when the confirm is cancelled", () => {
    const { onClearRecord } = renderList();
    fireEvent.click(screen.getByLabelText("Clear the record for Hard one"));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onClearRecord).not.toHaveBeenCalled();
  });
});
