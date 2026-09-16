// @vitest-environment happy-dom

/**
 * The Balance button posts `!balance` for anyone who is not self-hosting
 * (`GameTypePresetsControls.tsx`). A direct room runs coilbox's own room
 * server instead of SPADS, so a joiner pressing it there is asking the
 * founder rather than commanding a bot (issue #2871, replacing #2738's
 * outright hiding of the button with wording that says so). These tests go
 * through the component with `directRoom` and `selfHost` varied, the same
 * two facts `autohostHearsChat` decides on.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MemberRow } from "./config";
import { GameTypePresetsControls } from "./GameTypePresetsControls";

function row(name: string): MemberRow {
  return {
    name,
    kind: "human",
    self: false,
    host: false,
    boss: false,
    ready: true,
    sync: 1,
    spectator: false,
    teamId: 0,
    ally: 0,
    side: 0,
    colorHex: "#ffffff",
    handicap: 0,
  };
}

function drawPresets(over: { selfHost?: boolean; directRoom?: boolean } = {}) {
  render(
    <GameTypePresetsControls
      rows={[row("alice"), row("bob")]}
      me="alice"
      selfHost={over.selfHost ?? false}
      serverAssignsSeat={false}
      directRoom={over.directRoom ?? false}
      hostControls={{ forceTeam: () => {}, forceAlly: () => {} }}
      onSetBattleStatusBatch={() => {}}
      onAutohostSend={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("GameTypePresetsControls' Balance button", () => {
  // The gap this issue closes: a joiner's Balance used to disappear outright
  // in a direct room. Now it stays, worded as a request rather than a
  // command, and still sends `!balance` so the founder's chat can offer
  // Accept/Reject on it (issue #2871).
  it("reads as a suggestion for a joiner in a direct room", () => {
    drawPresets({ selfHost: false, directRoom: true });
    expect(screen.getByText("Suggest balance")).toBeTruthy();
    expect(screen.queryByText("Balance")).toBe(null);
  });

  // An ordinary lobby battle is assumed to have SPADS behind it, so a
  // joiner's Balance there is still a real command.
  it("reads as a command for a joiner in an ordinary lobby battle", () => {
    drawPresets({ selfHost: false, directRoom: false });
    expect(screen.getByText("Balance")).toBeTruthy();
    expect(screen.queryByText("Suggest balance")).toBe(null);
  });

  // The founder's own room acts through direct force calls, never through
  // chat, so a direct room does not turn Balance into a suggestion for its
  // own host.
  it("reads as a command for the founder of their own direct room", () => {
    drawPresets({ selfHost: true, directRoom: true });
    expect(screen.getByText("Balance")).toBeTruthy();
    expect(screen.queryByText("Suggest balance")).toBe(null);
  });

  // The other presets are a separate, existing gap this issue does not
  // cover (see the component doc), so they stay up regardless.
  it("leaves the other presets up for a joiner in a direct room", () => {
    drawPresets({ selfHost: false, directRoom: true });
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.getByText("FFA")).toBeTruthy();
  });
});
