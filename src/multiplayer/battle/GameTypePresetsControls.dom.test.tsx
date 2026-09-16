// @vitest-environment happy-dom

/**
 * The Balance button posts `!balance` for anyone who is not self-hosting
 * (`GameTypePresetsControls.tsx`), which assumes an autohost is listening. A
 * direct room runs coilbox's own room server instead of SPADS, so a joiner
 * pressing it there posts into a chat nobody reads (issue #2738). These
 * tests go through the component with `directRoom` and `selfHost` varied,
 * the same two facts `autohostHearsChat` decides on.
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
  // The gap this issue closes: a joiner's Balance would send `!balance` into
  // a direct room's chat, which no autohost ever reads.
  it("is hidden for a joiner in a direct room", () => {
    drawPresets({ selfHost: false, directRoom: true });
    expect(screen.queryByText("Balance")).toBe(null);
  });

  // An ordinary lobby battle is assumed to have SPADS behind it, so a
  // joiner's Balance there still has somewhere to go.
  it("is shown for a joiner in an ordinary lobby battle", () => {
    drawPresets({ selfHost: false, directRoom: false });
    expect(screen.getByText("Balance")).toBeTruthy();
  });

  // The founder's own room acts through direct force calls, never through
  // chat, so a direct room does not take Balance away from its host.
  it("is shown for the founder of their own direct room", () => {
    drawPresets({ selfHost: true, directRoom: true });
    expect(screen.getByText("Balance")).toBeTruthy();
  });

  // The other presets are a separate, existing gap this issue does not
  // cover (see the component doc), so they stay up regardless.
  it("leaves the other presets up for a joiner in a direct room", () => {
    drawPresets({ selfHost: false, directRoom: true });
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.getByText("FFA")).toBeTruthy();
  });
});
