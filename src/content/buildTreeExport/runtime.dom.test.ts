// @vitest-environment happy-dom
/**
 * The exported page's runtime, run for real: the generated document is put in a
 * DOM, the script is executed, and clicks and typing drive it. The three pieces
 * the runtime copies from the app (focus layout, neighbour set, search ranking)
 * are checked against the originals here.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { Side, UnitDatasetEntry } from "../bindings";
import { buildEdgeMap, focusNeighbours } from "../buildTree";
import { searchUnits } from "../buildTreeSearch";
import { layoutFocusTree } from "../pages/components/buildTreeLayout";
import { buildExportInput } from "./buildInput";
import { buildExportArtifact } from "./index";
import { TREE_JS } from "./runtime";

const units: UnitDatasetEntry[] = [
  {
    name: "armcom",
    fullName: "Arm Commander",
    mobile: true,
    buildOptions: ["armsolar", "armlab", "armvp", "armsola"],
    stats: { health: 3000, metalCost: 2500, range: 300 },
  },
  { name: "armsolar", fullName: "Solar Collector", mobile: false },
  // Same label as armsolar and sorts before it by id, but is laid out after
  // it, so ranking has to fall back to the id.
  { name: "armsola", fullName: "Solar Collector", mobile: false },
  {
    name: "armlab",
    fullName: "Bot Lab",
    mobile: false,
    buildOptions: ["armpw", "armck"],
    stats: {
      health: 1500,
      metalCost: 650,
      weapons: [{ damage: 12, reload: 0.5, range: 180, projectile: "laser" }],
    },
  },
  {
    name: "armvp",
    fullName: "Vehicle Plant",
    mobile: false,
    buildOptions: ["armck", "armfav"],
  },
  { name: "armpw", fullName: "Peewee", mobile: true },
  { name: "armck", fullName: "Construction Bot", mobile: true },
  { name: "armfav", fullName: "Jeffy", mobile: true },
  {
    name: "corecom",
    fullName: "Core Commander",
    mobile: true,
    buildOptions: ["cormex"],
  },
  { name: "cormex", fullName: "Metal Extractor", mobile: false },
] as UnitDatasetEntry[];

const sides = [
  { name: "Arm", startUnit: "armcom" },
  { name: "Core", startUnit: "corecom" },
] as Side[];

/** Units in the Arm tree: the commander and everything it reaches. */
const TOTAL = 8;

// The script adds listeners to the document and window, which outlive the
// page's elements. Each is recorded so a test can take them off again.
const added: [EventTarget, string, EventListenerOrEventListenerObject][] = [];
for (const target of [document, window] as EventTarget[]) {
  const original = target.addEventListener.bind(target);
  target.addEventListener = (type, listener, options) => {
    if (listener) added.push([target, type, listener]);
    original(type, listener, options);
  };
}

/** Put the exported page in the DOM and run its script. */
function load(): void {
  const out = buildExportArtifact(
    buildExportInput({
      gameName: "Test Game",
      sides,
      units,
      pics: {},
      date: "2026-07-21",
    }),
    { scope: "all", wrapper: "neutral", format: "html" },
  );
  if (out.format !== "html") throw new Error("expected html");
  const body = /<body>([\s\S]*?)<script>/.exec(out.html)?.[1] ?? "";
  document.body.innerHTML = body;
  new Function(TREE_JS)();
}

function node(id: string): Element {
  const el = document.querySelector(`.faction.active .node[data-id="${id}"]`);
  if (!el) throw new Error(`no node ${id}`);
  return el;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function visibleIds(): string[] {
  return [...document.querySelectorAll(".faction.active .node")]
    .filter((n) => !n.classList.contains("off"))
    .map((n) => n.getAttribute("data-id") ?? "")
    .sort();
}

function translateOf(el: Element): { x: number; y: number } {
  const m = /translate\(([^,]+),([^)]+)\)/.exec(
    el.getAttribute("transform") ?? "",
  );
  return { x: Number(m?.[1]), y: Number(m?.[2]) };
}

const detail = () =>
  document.querySelector(".faction.active .detail") as HTMLElement;

afterEach(() => {
  document.body.innerHTML = "";
  for (const [target, type, listener] of added.splice(0))
    target.removeEventListener(type, listener);
});

describe("click to focus", () => {
  it("shows only the unit, what it builds and what builds it", () => {
    load();
    click(node("armlab"));
    const edges = buildEdgeMap(units);
    expect(visibleIds()).toEqual([...focusNeighbours("armlab", edges)].sort());
    // armvp also builds armck, but is not a neighbour of armlab.
    expect(visibleIds()).not.toContain("armvp");
    expect(visibleIds()).toContain("armck");
  });

  it("lays the focus out the way the app does", () => {
    load();
    click(node("armlab"));
    const edges = buildEdgeMap(units);
    const set = focusNeighbours("armlab", edges);
    const builds = (edges.get("armlab") ?? [])
      .filter((id) => set.has(id))
      .sort();
    const builtBy = [...set]
      .filter(
        (id) =>
          id !== "armlab" &&
          !builds.includes(id) &&
          (edges.get(id)?.includes("armlab") ?? false),
      )
      .sort();
    const expected = layoutFocusTree("armlab", builds, builtBy);
    for (const [id, pos] of expected) {
      expect(translateOf(node(id))).toEqual(pos);
    }
  });

  it("fills the panel with the unit's stats and weapons", () => {
    load();
    expect(detail().hidden).toBe(true);
    click(node("armlab"));
    expect(detail().hidden).toBe(false);
    const text = detail().textContent ?? "";
    expect(text).toContain("Bot Lab");
    expect(text).toContain("armlab");
    expect(text).toContain("Health");
    expect(text).toContain("1500");
    expect(text).toContain("Metal cost");
    expect(text).not.toContain("Energy cost");
    expect(detail().querySelectorAll(".detail-weapons tbody tr")).toHaveLength(
      1,
    );
    expect(text).toContain("laser");
  });

  it("says so when the game gives a unit no stats", () => {
    load();
    click(node("armpw"));
    expect(detail().textContent).toContain("Peewee");
    expect(detail().textContent).toContain("no stats");
  });

  it("replaces the focus when another unit is clicked", () => {
    load();
    click(node("armlab"));
    click(node("armck"));
    expect(detail().textContent).toContain("Construction Bot");
    // armck is built by both labs.
    expect(visibleIds()).toEqual(["armck", "armlab", "armvp"]);
  });

  it("leaves focus on a click in the empty scene, restoring every unit", () => {
    load();
    const before = translateOf(node("armlab"));
    click(node("armlab"));
    expect(translateOf(node("armlab"))).not.toEqual(before);
    click(document.querySelector(".faction.active svg.scene") as Element);
    expect(detail().hidden).toBe(true);
    expect(visibleIds()).toHaveLength(TOTAL);
    expect(translateOf(node("armlab"))).toEqual(before);
    const edge = document.querySelector(".faction.active .edge") as Element;
    expect(edge.getAttribute("d")).toBe(edge.getAttribute("data-d0"));
  });

  it("leaves focus on Escape and on the panel's close button", () => {
    load();
    click(node("armlab"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(detail().hidden).toBe(true);
    click(node("armlab"));
    click(document.querySelector(".detail-close") as Element);
    expect(detail().hidden).toBe(true);
    expect(visibleIds()).toHaveLength(TOTAL);
  });

  it("focuses a unit from the keyboard", () => {
    load();
    node("armlab").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(detail().textContent).toContain("Bot Lab");
  });

  it("takes units outside the focus out of the tab order", () => {
    load();
    click(node("armlab"));
    expect(node("armsolar").getAttribute("tabindex")).toBe("-1");
    expect(node("armpw").getAttribute("tabindex")).toBe("0");
    click(document.querySelector(".faction.active svg.scene") as Element);
    expect(node("armsolar").getAttribute("tabindex")).toBe("0");
  });

  it("drops the focus when the faction tab changes", () => {
    load();
    click(node("armlab"));
    click(document.querySelector('.tab[data-tab="Core"]') as Element);
    click(document.querySelector('.tab[data-tab="Arm"]') as Element);
    expect(detail().hidden).toBe(true);
    expect(visibleIds()).toHaveLength(TOTAL);
  });

  it("does not take the pointer on a press, so the click still reaches the unit", () => {
    load();
    const svg = document.querySelector(
      ".faction.active svg.scene",
    ) as SVGSVGElement;
    let captured = 0;
    svg.setPointerCapture = () => {
      captured++;
    };
    const lab = node("armlab");
    lab.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5 }),
    );
    lab.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 6, clientY: 5 }),
    );
    lab.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    click(lab);
    expect(captured).toBe(0);
    expect(detail().textContent).toContain("Bot Lab");
  });

  it("ignores the click that ends a pan", () => {
    load();
    const svg = document.querySelector(
      ".faction.active svg.scene",
    ) as SVGSVGElement;
    svg.setPointerCapture = () => {};
    svg.releasePointerCapture = () => {};
    const lab = node("armlab");
    lab.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5 }),
    );
    lab.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 40, clientY: 5 }),
    );
    lab.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    click(lab);
    expect(detail().hidden).toBe(true);
    // The next click is a real one.
    click(lab);
    expect(detail().hidden).toBe(false);
  });
});

describe("search", () => {
  const input = () =>
    document.getElementById("unit-search") as HTMLInputElement;
  const options = () => [
    ...document.querySelectorAll("#unit-search-results [role=option]"),
  ];

  function type(value: string): void {
    input().value = value;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("lists matching units of the faction on show", () => {
    load();
    type("bot");
    expect(options().map((o) => o.getAttribute("data-id"))).toEqual([
      "armlab",
      "armck",
    ]);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    // Core's units are not in the Arm tree.
    type("metal");
    expect(options()).toHaveLength(0);
    expect(
      document.getElementById("unit-search-results")?.textContent,
    ).toContain("No units match");
  });

  it("ranks the way the app's search does", () => {
    load();
    const items = [...document.querySelectorAll(".faction.active .node")].map(
      (n) => ({
        id: n.getAttribute("data-id") ?? "",
        label: n.getAttribute("aria-label") ?? "",
      }),
    );
    for (const q of ["a", "bot", "arm", "e", "LAB", "co", "solar", "zzz"]) {
      type(q);
      expect(options().map((o) => o.getAttribute("data-id"))).toEqual(
        searchUnits(q, items).map((c) => c.id),
      );
    }
  });

  it("focuses the picked unit and clears the box", () => {
    load();
    type("peewee");
    options()[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(detail().textContent).toContain("Peewee");
    expect(input().value).toBe("");
    expect(options()).toHaveLength(0);
  });

  it("picks the highlighted result on Enter, and moves it with the arrows", () => {
    load();
    type("bot");
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(detail().textContent).toContain("Construction Bot");
  });

  it("clears the box on the first Escape and leaves focus on the second", () => {
    load();
    click(node("armlab"));
    type("bot");
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(input().value).toBe("");
    expect(detail().hidden).toBe(false);
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(detail().hidden).toBe(true);
  });
});
