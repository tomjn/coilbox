/**
 * Converting a base in a mission, with this machine's answers in it (issues
 * #1525, #1531).
 *
 * The panel itself is covered by
 * `../../../blueprint/pages/components/SubstitutionPanel.test.ts`. What this
 * covers is the half that was missing here: that the mission surface reads the
 * game's table and writes back to it, which the library surface has done since
 * issue #1468 and this one never has.
 *
 * The queues are the reason it matters. No reading of `armpw` reaches `corak`,
 * so a queued unit converts only where somebody has said what it is, and this is
 * the only surface with queues on it.
 */

import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { equivalentOf } from "@/blueprint/equivalents";
import {
  equivalentsFor,
  equivalentsKey,
  rememberEquivalence,
  resetEquivalents,
} from "@/blueprint/equivalentsStore";
import type { BaseBlueprint } from "@/blueprint/model";
import type { SubstitutionPanel } from "@/blueprint/pages/components/SubstitutionPanel";
import { sideUnitPrefixes } from "@/blueprint/substitution";
import { resetShortnames } from "@/container/shortnames";
import { SubstituteBaseForm } from "./SubstituteBaseForm";

type PanelProps = ComponentProps<typeof SubstitutionPanel>;

/** No engine, so nothing here goes near unitsync. The offer to read a game's
 *  own table needs one and is covered where it lives. */
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));

/** What the panel was handed, which is the whole question here. Rendered for
 *  real as well, so the markup below is the panel's own. */
let seen: PanelProps | undefined;

vi.mock(
  "@/blueprint/pages/components/SubstitutionPanel",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("@/blueprint/pages/components/SubstitutionPanel")
      >();
    return {
      SubstitutionPanel: (props: PanelProps) => {
        seen = props;
        return createElement(real.SubstitutionPanel, props);
      },
    };
  },
);

/** A webview's storage, which is where a game's table really lives. */
function stubStorage(): void {
  const held = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => held.set(key, value),
      removeItem: (key: string) => held.delete(key),
    },
  });
}

const GAME = "Scratch Mod 0.1";

const SIDES = sideUnitPrefixes([
  { name: "Armada", startUnit: "armcom" },
  { name: "Cortex", startUnit: "corcom" },
]);

const UNITS = [
  { name: "armllt", footprintX: 2, footprintZ: 2 },
  { name: "armpw", footprintX: 2, footprintZ: 2, mobile: true },
  { name: "corak", footprintX: 2, footprintZ: 2, mobile: true },
];

/** One turret nothing can be swapped for, so anything converted came from the
 *  queue rather than from the buildings. */
const layout: BaseBlueprint = {
  id: "l1",
  name: "One turret",
  buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 }],
};

function markup(queued: string[] = ["armpw"]): string {
  return renderToStaticMarkup(
    createElement(SubstituteBaseForm, {
      layout,
      queued,
      gameArchive: GAME,
      sides: SIDES,
      units: UNITS,
      unitsLoading: false,
      onApply: () => {},
    }),
  );
}

beforeEach(() => {
  stubStorage();
  resetEquivalents();
  resetShortnames();
  seen = undefined;
});

describe("SubstituteBaseForm", () => {
  it("converts a queued unit no naming reaches, once this game has been told what it is", () => {
    rememberEquivalence(
      equivalentsKey(GAME),
      "Armada",
      "armpw",
      "Cortex",
      "corak",
    );
    const html = markup();
    expect(html).toContain("Convert 1 queued unit to Cortex");
    expect(html).not.toContain("cannot build another side&#x27;s units");
  });

  it("suggests nothing for a queued unit nobody has said anything about", () => {
    const html = markup();
    expect(html).toContain("Queued on this base");
    expect(html).toContain("Nothing to convert");
  });

  it("reads the table of the game this mission is on, and no other", () => {
    rememberEquivalence("another game", "Armada", "armpw", "Cortex", "corak");
    expect(markup()).toContain("Nothing to convert");
  });

  it("holds onto what a conversion says, for the next base of this game", () => {
    markup();
    seen?.onRemember?.("Armada", "armpw", "Cortex", "corak");
    expect(
      equivalentOf("armpw", "Cortex", equivalentsFor(equivalentsKey(GAME))),
    ).toBe("corak");
  });
});
