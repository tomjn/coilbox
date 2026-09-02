/**
 * The set on its way out, rendered (issue #1474).
 *
 * `../../pack.test.ts` covers what writing a set means. What this covers is the
 * half a person is looking at when they decide: that every layout is drawn so a
 * set can be picked by picture rather than by name, that the buttons count what
 * is ticked, that what a game's file cannot hold is on screen next to the
 * button that drops it, and that a running game stops both ways out rather than
 * only the one that names a game.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { hubSource, type StoredBlueprint } from "../../library";
import { packStrips } from "../../pack";
import { LeavingPack } from "./LeavingPack";

const record = (
  id: string,
  patch: Partial<StoredBlueprint> = {},
): StoredBlueprint => ({
  id,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  layout: {
    game: { name: "Beyond All Reason test-1", shortname: "BAR" },
    name: `Layout ${id}`,
    buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
    footprints: { armsolar: { x: 4, z: 4 } },
  },
  ...patch,
});

const RECORDS = [record("a"), record("b"), record("c")];

function markup(
  over: {
    records?: StoredBlueprint[];
    taking?: Set<string>;
    gameFile?: string;
    gameRunning?: boolean;
    keepsProvenance?: boolean;
  } = {},
): string {
  const records = over.records ?? RECORDS;
  const taking = over.taking ?? new Set(["a", "b"]);
  return renderToStaticMarkup(
    createElement(LeavingPack, {
      records,
      taking,
      strips: packStrips(records.filter((one) => taking.has(one.id))),
      gameFile:
        "gameFile" in over
          ? over.gameFile
          : "/Users/someone/.spring/LuaUI/Config/blueprints.json",
      gameRunning: over.gameRunning ?? false,
      keepsProvenance: over.keepsProvenance ?? false,
      busy: false,
      onToggle: () => {},
      onAll: () => {},
      onClear: () => {},
      onWriteToGame: () => {},
      onWriteToFile: () => {},
    }),
  );
}

/** The layout drawings, which are the only pictures on the surface with a role
 *  on them. */
const drawings = (html: string) => html.match(/role="img"/g) ?? [];

/** Buttons that are really off, matched on the attribute rather than on the
 *  `disabled:` classes every button carries. */
const disabledButtons = (html: string) =>
  html.match(/<button[^>]*\sdisabled=""/g) ?? [];

describe("LeavingPack", () => {
  it("draws every layout, so a set is picked by picture rather than by name", () => {
    expect(drawings(markup())).toHaveLength(3);
  });

  it("counts what is ticked on the button that writes it", () => {
    expect(markup()).toContain("2 of 3 ticked");
    expect(markup()).toContain("2 blueprints");
    expect(markup({ taking: new Set(["a"]) })).toContain("1 blueprint");
  });

  it("names what a game's file has nowhere to keep, next to the button", () => {
    const html = markup();
    expect(html).toContain("which game 2 blueprints are for");
    expect(html).toContain("the footprints 2 blueprints carry");
  });

  it("says nothing about losses when there is nothing to lose", () => {
    const bare = record("a", {
      layout: { name: "Bare", buildings: [], footprints: {} },
    });
    expect(markup({ records: [bare], taking: new Set(["a"]) })).not.toContain(
      "leaves behind",
    );
  });

  /** The provenance decision, said out loud where somebody is about to share
   *  (issue #1473). A path off your disk is not a stranger's business. */
  it("says where a copy came from stays behind rather than travelling", () => {
    const from = record("a", { source: hubSource({ item: "item-7" }) });
    const html = markup({
      records: [from],
      taking: new Set(["a"]),
      keepsProvenance: true,
    });
    expect(html).toContain("never goes out in a file");
  });

  /** The game's own file, and only that one, because a file being posted is not
   *  one the running game will write back over (issue #1488). */
  it("stops the write into a game's file while a game is running, and says why", () => {
    const html = markup({ gameRunning: true });
    expect(html).toContain("A game is running.");
    expect(html).toContain("Saving a file somewhere else is fine");
    expect(disabledButtons(html)).toHaveLength(1);
  });

  /** Nothing to compare a destination against is nothing to reason with, so the
   *  broad refusal is what is left. */
  it("stops both ways out when it does not know where the engine writes", () => {
    const html = markup({ gameRunning: true, gameFile: undefined });
    expect(html).toContain("does not know where this engine writes");
    expect(disabledButtons(html)).toHaveLength(2);
  });

  it("offers no write at all until something is ticked", () => {
    expect(disabledButtons(markup({ taking: new Set() }))).toHaveLength(3);
  });
});
