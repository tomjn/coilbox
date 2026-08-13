/**
 * The pack, rendered.
 *
 * `../../pack.test.ts` covers what a file of layouts means. What this covers is
 * the half the whole feature rests on: that thirty layouts can be skimmed. Each
 * one is drawn, the one this game cannot place says so where it can be seen and
 * can be taken out of the list in one go, and the button counts what is ticked.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { barFormat } from "../../bar";
import { type PackPick, packPlan, readBlueprintPack } from "../../pack";
import { knownUnits } from "../../units";
import { ArrivingPack, type PackView } from "./ArrivingPack";

const PACK = readFileSync(
  join(__dirname, "..", "..", "fixtures", "bar-pack.json"),
  "utf8",
);

const GAME = "Balanced Antihilation test-1";
const INSTALLED = [{ name: GAME, info: { shortname: "BA" } }];
const UNITS = [
  { name: "armsolar", footprintX: 4, footprintZ: 4 },
  { name: "armmex", footprintX: 3, footprintZ: 3 },
  { name: "armwin", footprintX: 2, footprintZ: 2 },
  { name: "armllt", footprintX: 2, footprintZ: 2 },
  { name: "armlab", footprintX: 8, footprintZ: 6 },
];

function picks(taking: number[] = [], taken: string[] = []): PackPick[] {
  return packPlan({
    entries: readBlueprintPack(barFormat, PACK).entries,
    taking: new Set(taking),
    taken,
    installed: INSTALLED,
    known: knownUnits(UNITS),
    footprintOf: (def) => {
      const unit = UNITS.find((one) => one.name === def.toLowerCase());
      return { x: unit?.footprintX ?? 1, z: unit?.footprintZ ?? 1 };
    },
    gameName: GAME,
  });
}

const VIEW: PackView = { order: "fit", hideUnplaceable: false };

function markup(
  over: {
    picks?: PackPick[];
    view?: PackView;
    changes?: string | null;
    unreadable?: number;
    checked?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(ArrivingPack, {
      file: "/Users/someone/Downloads/blueprints.json",
      picks: over.picks ?? picks(),
      view: over.view ?? VIEW,
      onView: () => {},
      games: [GAME],
      game: GAME,
      onGame: () => {},
      unreadable: over.unreadable ?? 1,
      changes: over.changes ?? null,
      checked: over.checked ?? true,
      busy: false,
      onToggle: () => {},
      onTakeAll: () => {},
      onClear: () => {},
      onKeep: () => {},
    }),
  );
}

/** The layout drawings, which are the only pictures on the surface with a role
 *  on them. Everything else drawn is an icon. */
const drawings = (html: string) => html.match(/role="img"/g) ?? [];

describe("ArrivingPack", () => {
  it("draws every layout in the pack, so it can be recognised rather than read", () => {
    expect(drawings(markup())).toHaveLength(8);
  });

  it("says how many of them this game can place", () => {
    expect(markup()).toContain("7 of 8 can be placed");
  });

  it("marks the one this game cannot place, and only that one", () => {
    const html = markup();
    expect(html.match(/data-fit="none"/g)).toHaveLength(1);
    expect(html).toContain("This game has none of its units");
    expect(html).toContain("corsolar");
  });

  it("takes the unplaceable one out of the list in one go", () => {
    const html = markup({ view: { order: "fit", hideUnplaceable: true } });
    expect(drawings(html)).toHaveLength(7);
    expect(html).not.toContain('data-fit="none"');
  });

  it("says what a layout would be kept as when the library has that name", () => {
    const html = markup({ picks: picks([0], ["Opening solars"]) });
    expect(html).toContain("kept as");
    expect(html).toContain("Opening solars 2");
  });

  it("counts what is ticked on the button, and asks for one when none is", () => {
    expect(markup({ picks: picks([0, 1]) })).toContain("Add 2 to my library");
    expect(markup()).toContain("Tick the ones you want");
  });

  it("says once what reading the file changed, and what it could not read", () => {
    const html = markup({ changes: "Reading this file turned 1 of them." });
    expect(html).toContain("Reading this file turned 1 of them.");
    expect(html).toContain("1 other entry is in this file");
  });

  it("says nothing has been checked when the game's units are not read", () => {
    expect(markup({ checked: false })).toContain(
      "nothing here has been checked",
    );
  });
});
