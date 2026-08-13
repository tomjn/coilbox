/**
 * The arriving layout, rendered.
 *
 * `../../arrival.test.ts` covers what a layout arriving somewhere means. What
 * this covers is that the meaning reaches the screen: that a warning is a
 * warning rather than a line of grey text, that the button says something
 * different for a layout none of whose units are here, and that the layout is
 * drawn rather than described.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blueprintArrival } from "../../arrival";
import type { BlueprintPayload } from "../../payload";
import { knownUnits } from "../../units";
import { ArrivingBlueprint } from "./ArrivingBlueprint";

const INSTALLED = [
  { name: "Balanced Antihilation 12.34", info: { shortname: "BA" } },
];

const UNITS = [{ name: "armsolar" }, { name: "armmex" }];

function payload(over: Partial<BlueprintPayload> = {}): BlueprintPayload {
  return {
    game: { name: "Balanced Antihilation 12.34" },
    name: "Opening solars",
    buildings: [
      { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
      { def: "armmex", offset: { x: 96, z: 0 }, facing: 0 },
    ],
    footprints: { armsolar: { x: 2, z: 2 }, armmex: { x: 1, z: 1 } },
    ...over,
  };
}

function markup(
  value: BlueprintPayload,
  taken: string[] = [],
  known = knownUnits(UNITS),
): string {
  return renderToStaticMarkup(
    createElement(ArrivingBlueprint, {
      payload: value,
      arrival: blueprintArrival({
        payload: value,
        taken,
        installed: INSTALLED,
        known,
      }),
      busy: false,
      onTake: () => {},
    }),
  );
}

describe("ArrivingBlueprint", () => {
  it("draws the layout, one square per building", () => {
    expect(markup(payload()).match(/<rect/g)).toHaveLength(2);
  });

  it("offers to keep a layout this game has all the units of", () => {
    const html = markup(payload());
    expect(html).toContain("Add to my library");
    expect(html).toContain("2 buildings");
    expect(html).toContain("Balanced Antihilation 12.34");
  });

  it("gives a warning the weight of a warning", () => {
    const html = markup(
      payload({
        buildings: [{ def: "legsolar", offset: { x: 0, z: 0 }, facing: 0 }],
      }),
    );
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain("legsolar");
    expect(html).toContain("Keep it anyway");
  });

  it("shows the name it will be kept under, not the one it came with", () => {
    const html = markup(payload(), ["Opening solars"]);
    expect(html).toContain("Opening solars 2");
    expect(html).toContain('data-tone="note"');
  });

  it("says a layout naming no game names none", () => {
    const html = markup(payload({ game: undefined }));
    expect(html).toContain("No game named");
  });
});
