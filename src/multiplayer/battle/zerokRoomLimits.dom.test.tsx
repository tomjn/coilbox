// @vitest-environment happy-dom

/**
 * The settings a Zero-K room cannot carry, said rather than silently broken
 * (issue #1979).
 *
 * `mp_set_script_tags` splits a tag map into Zero-K's `SetModOptions` and
 * `SetMapOptions`, and neither has a home for a start position type or a unit
 * restriction, so a founder who set one on a Zero-K connection was writing to
 * nothing and being shown their own optimistic value back.
 *
 * The reason is the point. Hiding the control would leave somebody hunting for a
 * setting every other lobby has, and disabling it would still claim the room has
 * a start position mode when the protocol has no such thing.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Battle } from "../bindings";
import {
  startPositionsUnavailable,
  unitRestrictionsUnavailable,
} from "../protocol";
import { StartPosOptions } from "./StartPosOptions";

function battle(): Battle {
  return {
    id: 7,
    tachyonId: null,
    host: "me",
    ip: "",
    port: "",
    natType: "0",
    map: "Comet Catcher Remake 1.8",
    maphash: "",
    modname: "Zero-K v1.12.6.0",
    engine: "",
    version: "",
    maxPlayers: 8,
    playerCount: null,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: "A room",
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
    bosses: [],
    bossesEnabled: false,
    inProgress: false,
    mode: "custom",
  };
}

afterEach(cleanup);

describe("the start position card on a Zero-K room", () => {
  it("says why there is nothing to set", () => {
    render(
      <StartPosOptions
        battle={battle()}
        canEdit={true}
        unavailable={startPositionsUnavailable("zerok")}
        sendOption={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "Zero-K's lobby protocol carries no start positions, so coilbox cannot set them for this room.",
      ),
    ).toBeTruthy();
  });

  // The failure this replaces. A select the founder can move, whose value goes
  // nowhere and comes back looking like it was accepted.
  it("offers no control to move", () => {
    render(
      <StartPosOptions
        battle={battle()}
        canEdit={true}
        unavailable={startPositionsUnavailable("zerok")}
        sendOption={() => {}}
      />,
    );

    expect(screen.queryByRole("combobox")).toBe(null);
  });

  // A room with no mode is not a room set to the first mode in the list. Reading
  // the default back would tell everybody in a Zero-K room that their teams
  // spawn at numbered map positions, which is a claim about the game.
  it("does not fall back to naming a mode nobody chose", () => {
    render(
      <StartPosOptions
        battle={battle()}
        canEdit={false}
        unavailable={startPositionsUnavailable("zerok")}
        sendOption={() => {}}
      />,
    );

    expect(screen.queryByText("Fixed (map positions)")).toBe(null);
  });

  // The two protocols that do carry it are untouched, which is what stops this
  // from being a Zero-K branch in a shared component.
  it("leaves the control alone on a connection that carries the setting", () => {
    render(
      <StartPosOptions
        battle={battle()}
        canEdit={true}
        unavailable={startPositionsUnavailable("tasserver")}
        sendOption={() => {}}
      />,
    );

    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});

describe("the words themselves", () => {
  // They are two different settings and the reader is looking at one of them, so
  // each names its own.
  it("names the setting it is about, rather than saying the protocol is limited", () => {
    expect(startPositionsUnavailable("zerok")).toContain("start positions");
    expect(unitRestrictionsUnavailable("zerok")).toContain("unit restrictions");
  });
});
