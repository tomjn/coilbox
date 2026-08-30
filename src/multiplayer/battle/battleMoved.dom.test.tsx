// @vitest-environment happy-dom

/**
 * What somebody sitting in a battle is told when the battle moves onto a
 * different address under them (issue #2073).
 *
 * The move itself is proved elsewhere and in Rust: the reducer folds
 * `BATTLEHOSTMOVED` into the battle's address, coilbox's own room server sends
 * the line to every peer when the machine it runs on changes address, and the
 * direct crate's wire test reads it arriving at a joiner. What none of that
 * covers is the half a person sees, which is this.
 *
 * Driven through `recordBattleMoved`, which is the one line `store.tsx` runs on
 * the delta. That line is not covered here, in company with every other notice
 * in that file.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BattleMovedPanel } from "./BattleMovedPanel";
import {
  forgetBattleMovedUnless,
  recordBattleMoved,
  useBattleMoved,
} from "./battleMoved";

afterEach(() => {
  cleanup();
  // Leaves this client in no battle, which drops any record, so the next test
  // starts on somebody who has been told nothing.
  forgetBattleMovedUnless(null);
});

/** The battle room, for somebody who joined battle 9 and does not run it. */
function joinerIn(id: number) {
  render(<BattleMovedPanel battleId={id} selfHost={false} />);
}

describe("a battle that moves under the people sitting in it", () => {
  // The failure this exists for. Everybody in the room is holding an address
  // that has stopped working, coilbox quietly starts using a different one, and
  // the only person told is the one running the battle.
  it("tells a joiner in words that the address moved and that coilbox followed", () => {
    recordBattleMoved(9);
    joinerIn(9);

    expect(
      screen.getByText(
        "This battle has moved onto a different address, because the connection the host runs it on moved. Coilbox has followed it, so starting the game from here uses the new one. Anybody already in the game was connected to the address it has left.",
      ),
    ).toBeTruthy();
  });

  // It arrives while somebody is reading the roster or waiting to be readied up,
  // so it has to be heard rather than only appear.
  it("says it out loud", () => {
    recordBattleMoved(9);
    joinerIn(9);

    expect(screen.getByRole("status").textContent).toContain(
      "has moved onto a different address",
    );
  });

  // An ordinary battle is the common case and must be left alone. The element
  // and not only its words, because a strip that drew itself empty would be a
  // bordered box and an icon under the header of every battle anybody joins.
  it("draws nothing at all until something moves", () => {
    joinerIn(9);

    expect(screen.queryByRole("status")).toBe(null);
    expect(document.body.textContent).toBe("");
  });

  // The record names a battle because a record that did not would be read by
  // whoever came next. Somebody watching battle 4 move from the battle list is
  // in battle 9, and nothing about battle 9 changed.
  it("stays quiet when the battle that moved is somebody else's", () => {
    recordBattleMoved(4);
    joinerIn(9);

    expect(screen.queryByRole("status")).toBe(null);
  });

  // Not because a host does not care, but because a host has been told: a LAN
  // room's own strip sits directly above this one, and a relay host asked for
  // the move themselves.
  it("says nothing to the host, who has already been told", () => {
    recordBattleMoved(9);
    render(<BattleMovedPanel battleId={9} selfHost={true} />);

    expect(screen.queryByRole("status")).toBe(null);
  });

  // A move is a fact that keeps rather than a question waiting on an answer,
  // which is why it is a strip and not a notification. Somebody who went to
  // Content to start a download finds it still there.
  it("is still there after a walk away from the battle room and back", () => {
    recordBattleMoved(9);
    joinerIn(9);
    cleanup();

    joinerIn(9);
    expect(screen.getByRole("status").textContent).toContain(
      "Coilbox has followed it",
    );
  });
});

describe("forgetting a move", () => {
  /** Reads the record the way the panel does, without rendering the panel. */
  function reading() {
    let seen: number | null = null;
    function Probe() {
      seen = useBattleMoved();
      return null;
    }
    render(<Probe />);
    return seen;
  }

  // The one way to be stale: leaving battle 9 and joining it again hands this
  // client the new address in the ordinary BATTLEOPENED, so there is no dead
  // address to warn about and the old record must not resurface.
  it("drops a move once this client is in a different battle", () => {
    recordBattleMoved(9);
    forgetBattleMovedUnless(4);

    expect(reading()).toBe(null);
  });

  // The clear runs on every change of the battle we are in, including the change
  // into the battle that then moves, so it must not eat the record it is about.
  it("keeps a move about the battle this client is in", () => {
    recordBattleMoved(9);
    forgetBattleMovedUnless(9);

    expect(reading()).toBe(9);
  });
});
