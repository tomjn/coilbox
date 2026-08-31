# Browse a game's units in the app: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every installed game a browsable unit encyclopedia in the app: a grid of its units grouped by faction, and a page per unit that leads with the model and answers what it costs, what it builds and what it turns into.

**Architecture:** User interface over data coilbox already fetches. `useUnitsyncUnitDataset` returns every unit with stats, weapons, build options, morph targets, footprints and model name, cached in a module map and again on disk in the worker. The grouping helpers (`buildTechForest`, `factionGroups`, `morphGroups`, `groupOf`) already exist and already handle morph edges. So this is two new routes, one pure module, two pages and one shared stats component. No Rust, no worker changes, no new dependency.

**Tech Stack:** TypeScript, React, react-router (`useParams`), vitest for pure functions, happy-dom with testing-library for page tests (`.dom.test.tsx`), biome, tsc.

**Spec:** `docs/superpowers/specs/2026-08-31-game-unit-encyclopedia-design.md`. Read it. It records why each decision was made and what was deliberately left out.

## Global constraints

- No new dependency. There is no virtualisation library in this repo and none is to be added. Long lists use a render budget per section, the shape `UnitPicker.tsx:577` already uses, with `loading="lazy"` on images.
- Absent means absent. A field the unitdef does not declare gets no row, never a zero. `shared/unitdef-stats.json` writes the rule down and the dataset already honours it.
- Def keys are lowercase throughout, matching the dataset and every existing graph helper.
- An upgrade count excludes the base, matching what the build tree and the unit picker already display.
- Both routes are wrapped in `gateProfileHidden("content.games", ...)`, so a distribution profile that hides games hides these too.
- Morph conditions are free JSON keyed however the game keyed them. Nothing here names an individual condition.
- Commit messages are plain imperative sentences in this repo's house style, no `feat:` prefixes.
- Before any PR: `bun run test`, `bunx biome ci .`, `bun run typecheck`. Rust is untouched by this plan.

## File structure

- Create `src/content/unitEncyclopedia.ts`: the grid's whole model, as pure functions over a dataset. Its own file rather than more of `techForest.ts`, because that file is the picker's model and this is the encyclopedia's, and neither should grow the other's concerns.
- Create `src/content/unitEncyclopedia.test.ts`.
- Create `src/content/pages/GameUnitsPage.tsx`: the grid.
- Create `src/content/pages/GameUnitsPage.dom.test.tsx`.
- Create `src/content/pages/GameUnitPage.tsx`: one unit.
- Create `src/content/pages/GameUnitPage.dom.test.tsx`.
- Create `src/content/pages/components/UnitStatsTable.tsx`: the stats and weapons block, standalone so the build tree drawer can adopt it later.
- Modify `src/content/index.ts`: two routes beside the existing game routes.
- Modify `src/content/pages/GameDetailPage.tsx`: a link into the encyclopedia.

---

### Task 1: The grid's model

**Files:**
- Create: `src/content/unitEncyclopedia.ts`
- Create: `src/content/unitEncyclopedia.test.ts`

**Interfaces:**
- Consumes: `buildTechForest(units, roots)` and `factionGroups(forest, ids, label, heading, match)` from `src/content/techForest.ts`, `morphGroups(units)` and `groupOf(groups)` from `src/content/morphGraph.ts`, the `UnitDatasetEntry` type from `src/content/bindings.ts`.
- Produces:
  - `interface UnitCell { id: string; label: string; upgrades: number; stages: string[] }`
  - `interface UnitSection { id: string; label: string; cells: UnitCell[] }`
  - `encyclopediaSections(units: UnitDatasetEntry[], roots: { id: string; label: string }[], query: string): UnitSection[]`
  - `unitLabel(unit: UnitDatasetEntry | undefined, id: string): string`

- [ ] **Step 1: Write the failing tests**

Create `src/content/unitEncyclopedia.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import { encyclopediaSections, unitLabel } from "./unitEncyclopedia";

function unit(
  name: string,
  extra: Partial<UnitDatasetEntry> = {},
): UnitDatasetEntry {
  return { name, ...extra };
}

const ARMADA = [{ id: "armcom", label: "Armada" }];

describe("encyclopediaSections", () => {
  it("puts a faction's units under that faction", () => {
    const units = [
      unit("armcom", { buildOptions: ["armsolar"] }),
      unit("armsolar", { fullName: "Solar Collector" }),
    ];
    const sections = encyclopediaSections(units, ARMADA, "");
    expect(sections.map((s) => s.label)).toEqual(["Armada"]);
    expect(sections[0].cells.map((c) => c.id)).toEqual(["armcom", "armsolar"]);
  });

  it("puts a unit no faction reaches in its own block", () => {
    const units = [unit("armcom"), unit("armghost")];
    const sections = encyclopediaSections(units, ARMADA, "");
    expect(sections.map((s) => s.label)).toEqual(["Armada", "Other units"]);
    expect(sections[1].cells.map((c) => c.id)).toEqual(["armghost"]);
  });

  it("folds a commander's upgrades into one cell", () => {
    const units = [
      unit("armcom", { morphTargets: [{ into: "armcom1" }] }),
      unit("armcom1", { morphTargets: [{ into: "armcom2" }] }),
      unit("armcom2"),
    ];
    const sections = encyclopediaSections(units, ARMADA, "");
    expect(sections[0].cells.map((c) => c.id)).toEqual(["armcom"]);
    expect(sections[0].cells[0].upgrades).toBe(2);
    expect(sections[0].cells[0].stages).toEqual(["armcom1", "armcom2"]);
  });

  it("gives a unit that morphs nowhere no upgrades", () => {
    const units = [unit("armcom", { buildOptions: ["armsolar"] }), unit("armsolar")];
    const sections = encyclopediaSections(units, ARMADA, "");
    const solar = sections[0].cells.find((c) => c.id === "armsolar");
    expect(solar?.upgrades).toBe(0);
    expect(solar?.stages).toEqual([]);
  });

  it("finds a unit by its def key", () => {
    const units = [
      unit("armcom", { buildOptions: ["armsolar"] }),
      unit("armsolar", { fullName: "Solar Collector" }),
    ];
    const sections = encyclopediaSections(units, ARMADA, "armsolar");
    expect(sections.flatMap((s) => s.cells).map((c) => c.id)).toEqual(["armsolar"]);
  });

  it("finds a unit by the name a player sees", () => {
    const units = [
      unit("armcom", { buildOptions: ["armsolar"] }),
      unit("armsolar", { fullName: "Solar Collector" }),
    ];
    const sections = encyclopediaSections(units, ARMADA, "solar coll");
    expect(sections.flatMap((s) => s.cells).map((c) => c.id)).toEqual(["armsolar"]);
  });

  it("finds a folded stage by its own def key", () => {
    // The one people notice: a def key pasted out of a mission file or a replay
    // belongs to a stage that has no cell of its own.
    const units = [
      unit("armcom", { morphTargets: [{ into: "armcom1" }] }),
      unit("armcom1"),
    ];
    const sections = encyclopediaSections(units, ARMADA, "armcom1");
    expect(sections.flatMap((s) => s.cells).map((c) => c.id)).toEqual(["armcom"]);
  });

  it("drops a section left empty by the search", () => {
    const units = [unit("armcom"), unit("armghost")];
    const sections = encyclopediaSections(units, ARMADA, "armghost");
    expect(sections.map((s) => s.label)).toEqual(["Other units"]);
  });

  it("puts everything in one block when the game's sides could not be read", () => {
    // The spec names this: a game with no start units degrades to one long
    // block rather than to an empty page, which is what the picker does too.
    const units = [unit("armcom"), unit("armsolar")];
    const sections = encyclopediaSections(units, [], "");
    expect(sections.map((s) => s.label)).toEqual(["Other units"]);
    expect(sections[0].cells.map((c) => c.id)).toEqual(["armcom", "armsolar"]);
  });

  it("matches case insensitively and ignores surrounding space", () => {
    const units = [unit("armcom"), unit("armsolar", { fullName: "Solar Collector" })];
    const sections = encyclopediaSections(units, ARMADA, "  ARMSOLAR ");
    expect(sections.flatMap((s) => s.cells).map((c) => c.id)).toEqual(["armsolar"]);
  });
});

describe("unitLabel", () => {
  it("prefers the name a player sees", () => {
    expect(unitLabel({ name: "armsolar", fullName: "Solar Collector" }, "armsolar")).toBe(
      "Solar Collector",
    );
  });

  it("falls back to the def key when the game names nothing", () => {
    expect(unitLabel({ name: "armsolar" }, "armsolar")).toBe("armsolar");
    expect(unitLabel(undefined, "armsolar")).toBe("armsolar");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/content/unitEncyclopedia.test.ts`
Expected: FAIL, cannot resolve `./unitEncyclopedia`.

- [ ] **Step 3: Write the implementation**

Create `src/content/unitEncyclopedia.ts`:

```ts
import type { UnitDatasetEntry } from "./bindings";
import { groupOf, morphGroups } from "./morphGraph";
import { buildTechForest, factionGroups } from "./techForest";

/**
 * The encyclopedia grid's model: which units a game has, grouped the way a
 * reader looks for them. Designed in
 * `docs/superpowers/specs/2026-08-31-game-unit-encyclopedia-design.md`.
 *
 * Kept apart from `techForest.ts`, which is the unit picker's model. The two
 * read the same graph helpers and answer different questions, and a shared file
 * would grow both concerns.
 */

/** One cell of the grid: a unit, plus the stages folded into it. */
export interface UnitCell {
  /** The def key the cell links to: a morph group's base, or the unit itself. */
  id: string;
  /** The name a reader sees, falling back to the def key. */
  label: string;
  /** How many stages are folded in, excluding the base, so it matches the
   * count the build tree and the unit picker already show. */
  upgrades: number;
  /** The folded stage ids, excluding the base. Empty for a unit that morphs
   * nowhere. Search reaches these, which is how a pasted def key finds a unit
   * that has no cell of its own. */
  stages: string[];
}

/** One block of the grid: a faction, or the units no faction reaches. */
export interface UnitSection {
  /** The root unit id, or `""` for the block nothing reaches. */
  id: string;
  label: string;
  cells: UnitCell[];
}

/** The name a reader sees for a unit, falling back to its def key. A game that
 * names nothing still has to be readable. */
export function unitLabel(
  unit: UnitDatasetEntry | undefined,
  id: string,
): string {
  const full = unit?.fullName?.trim();
  return full && full.length > 0 ? full : id;
}

/**
 * The grid, grouped by faction with a unit's morph stages folded into one cell.
 *
 * `roots` is the game's start units with the faction names to head their
 * blocks. A root the dataset does not hold is dropped by `buildTechForest`, so
 * a game whose sides could not be read degrades to one block of everything
 * rather than to nothing.
 *
 * A cell matches the search when its own def key matches, when the name a
 * reader sees matches, or when one of its folded stages' def keys matches. The
 * third is the one people notice: a def key pasted out of a mission file, a
 * replay or a game's own config usually belongs to a stage, and a stage has no
 * cell to find.
 */
export function encyclopediaSections(
  units: UnitDatasetEntry[],
  roots: { id: string; label: string }[],
  query: string,
): UnitSection[] {
  const byId = new Map(units.map((u) => [u.name.toLowerCase(), u]));
  const forest = buildTechForest(
    units,
    roots.map((r) => r.id),
  );
  const headings = new Map(roots.map((r) => [r.id.toLowerCase(), r.label]));

  const base = groupOf(morphGroups(units));
  const stagesOf = new Map<string, string[]>();
  for (const [stage, root] of base) {
    if (stage === root) continue;
    stagesOf.set(root, [...(stagesOf.get(root) ?? []), stage]);
  }

  // Only the id a cell stands for is laid out. A folded stage is reachable
  // through its base's cell rather than through one of its own.
  const cellIds = [...forest.known].filter((id) => (base.get(id) ?? id) === id);

  const q = query.trim().toLowerCase();
  const label = (id: string) => unitLabel(byId.get(id), id);
  const matches = (id: string) => {
    if (q.length === 0) return true;
    if (id.includes(q)) return true;
    if (label(id).toLowerCase().includes(q)) return true;
    return (stagesOf.get(id) ?? []).some((stage) => stage.includes(q));
  };

  return factionGroups(
    forest,
    cellIds,
    label,
    (rootId) => headings.get(rootId) ?? rootId,
    matches,
  ).map((group) => ({
    id: group.id,
    label: group.label,
    cells: group.units.map((id) => {
      const stages = (stagesOf.get(id) ?? []).slice().sort();
      return { id, label: label(id), upgrades: stages.length, stages };
    }),
  }));
}
```

Note on the heading for the block nothing reaches: `factionGroups` already labels it "Other units" and the tests above expect that string, so the `headings` lookup is never asked for it.

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/content/unitEncyclopedia.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Check the whole suite and the linters**

Run: `bun run test`, then `bunx biome ci .` and `bun run typecheck`.
Expected: all pass. Nothing else imports this file yet, so a failure here is this file's own.

- [ ] **Step 6: Commit**

```bash
git add src/content/unitEncyclopedia.ts src/content/unitEncyclopedia.test.ts
git commit -m "Model a game's units as a grid grouped by faction"
```

---

### Task 2: The grid page

**Files:**
- Create: `src/content/pages/GameUnitsPage.tsx`
- Create: `src/content/pages/GameUnitsPage.dom.test.tsx`
- Modify: `src/content/index.ts` (routes list, beside `content/games/:name`)
- Modify: `src/content/pages/GameDetailPage.tsx` (a link into the encyclopedia)

**Interfaces:**
- Consumes: `encyclopediaSections`, `UnitSection`, `UnitCell`, `unitLabel` from Task 1.
- Produces: the route `content/games/:name/units`, and a default-exported `GameUnitsPage` component.

Read `src/content/pages/GameDetailPage.tsx` before starting. Its first 100 lines are the pattern this page copies: `useParams()`, `decodeURIComponent`, `useScanTargetSelection()`, `useUnitsyncScan(enginePath, rootPath)`, `data?.games.find((g) => g.name === decoded)`, then `useUnitsyncGameInfo` for the sides and `useUnitsyncUnitDataset` for the units. Copy that preamble rather than inventing one.

- [ ] **Step 1: Write the failing test**

Create `src/content/pages/GameUnitsPage.dom.test.tsx`. Follow the mocking shape `src/content/pages/components/UnitPicker.dom.test.tsx` uses: mock the hooks the page calls so the test drives the rendered output rather than unitsync. Cover three things, because these are what the page exists to do:

```tsx
it("shows one cell for a commander and its upgrades", async () => {
  renderPage({
    units: [
      { name: "armcom", fullName: "Commander", morphTargets: [{ into: "armcom1" }] },
      { name: "armcom1", fullName: "Commander" },
    ],
    sides: [{ name: "Armada", startUnit: "armcom" }],
  });
  expect(await screen.findByText("Commander")).toBeTruthy();
  expect(screen.queryByText("armcom1")).toBeNull();
  expect(screen.getByText(/1 upgrade/)).toBeTruthy();
});

it("finds a folded stage by its def key", async () => {
  renderPage({
    units: [
      { name: "armcom", fullName: "Commander", morphTargets: [{ into: "armcom1" }] },
      { name: "armcom1", fullName: "Commander" },
      { name: "armsolar", fullName: "Solar Collector" },
    ],
    sides: [{ name: "Armada", startUnit: "armcom" }],
  });
  await userEvent.type(screen.getByRole("searchbox"), "armcom1");
  expect(screen.getByText("Commander")).toBeTruthy();
  expect(screen.queryByText("Solar Collector")).toBeNull();
});

it("heads each block with its faction", async () => {
  renderPage({
    units: [
      { name: "armcom", buildOptions: ["armsolar"] },
      { name: "armsolar" },
      { name: "armghost" },
    ],
    sides: [{ name: "Armada", startUnit: "armcom" }],
  });
  expect(await screen.findByText("Armada")).toBeTruthy();
  expect(screen.getByText("Other units")).toBeTruthy();
});
```

Write `renderPage` as a local helper in that file that mounts the page inside a router with the `:name` param set and the mocked hooks returning the given units and sides.

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/content/pages/GameUnitsPage.dom.test.tsx`
Expected: FAIL, cannot resolve `./GameUnitsPage`.

- [ ] **Step 3: Write the page**

`GameUnitsPage.tsx` renders, in order: the game's name as a heading with a link back to the game, a search input with `type="search"`, then one block per section from `encyclopediaSections`, each block a heading and a grid of cells. A cell is a link to `../units/{id}` showing the buildpic, the label, and `{n} upgrade` or `{n} upgrades` when `upgrades > 0`.

Buildpics come from `useUnitsyncUnitBuildpics(enginePath, dataDir, gameArchive, ids)` where `ids` are the cell ids currently rendered, read through the existing `unitIconSrc` helper rather than reaching into `iconFile` or `icon` directly. Put `loading="lazy"` on every image.

Cap what is drawn: keep a running budget across sections, in the shape `UnitPicker.tsx:577` uses (`const shown = group.units.slice(0, Math.max(left, 0))`), and below the last drawn cell show how many units the budget left out. Silently drawing a subset would read as a game with fewer units than it has.

Handle the three states the dataset hook reports the way `GameDetailPage` does: loading, error with the errors listed, and ready.

- [ ] **Step 4: Register the route**

In `src/content/index.ts`, beside the existing `content/games/:name` entry:

```ts
    {
      path: "content/games/:name/units",
      lazy: gateProfileHidden(
        "content.games",
        () => import("./pages/GameUnitsPage"),
      ),
      crumb: "Units",
    },
```

- [ ] **Step 5: Link it from the game page**

In `GameDetailPage.tsx`, near where the build tree is offered, add a link to `units` reading "Browse units". A reader who has the build tree in front of them is already asking about this game's units.

- [ ] **Step 6: Run the tests and the linters**

Run: `bunx vitest run src/content/pages/GameUnitsPage.dom.test.tsx`, then `bun run test`, `bunx biome ci .` and `bun run typecheck`.
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/content/pages/GameUnitsPage.tsx src/content/pages/GameUnitsPage.dom.test.tsx src/content/index.ts src/content/pages/GameDetailPage.tsx
git commit -m "Browse a game's units as a grid grouped by faction"
```

---

### Task 3: A unit's page, with its model

**Files:**
- Create: `src/content/pages/GameUnitPage.tsx`
- Create: `src/content/pages/GameUnitPage.dom.test.tsx`
- Modify: `src/content/index.ts` (one more route)

**Interfaces:**
- Consumes: `unitLabel` from Task 1, `UnitModelPanel` from `src/content/pages/components/UnitModelPanel.tsx`.
- Produces: the route `content/games/:name/units/:unit`, and a default-exported `GameUnitPage` component.

`UnitModelPanel`'s props are `{ enginePath, dataDir, gameArchive, unitId, unit, onClose }` where `unit` is the `UnitDatasetEntry`. It reads the model name from `unit.objectName` itself.

The model leads the page visually and nothing waits for it. Everything else renders from the dataset, which is already cached by the time this page opens, and the viewport fills its box when the model arrives. A page that blocked on the model would answer more slowly than the build tree it replaced.

- [ ] **Step 1: Write the failing test**

Create `src/content/pages/GameUnitPage.dom.test.tsx`, mocking hooks the same way Task 2's test does:

```tsx
it("names the unit and shows its def key", async () => {
  renderUnit("armsolar", [{ name: "armsolar", fullName: "Solar Collector" }]);
  expect(await screen.findByRole("heading", { name: "Solar Collector" })).toBeTruthy();
  expect(screen.getByText("armsolar")).toBeTruthy();
});

it("is readable while the model is still loading", async () => {
  // The model hook never resolves here. Leading with the model is a layout
  // decision, so everything the dataset already holds must be on screen anyway.
  // Task 4 adds the stats and relationships below this, and they inherit the
  // same guarantee.
  renderUnit(
    "armsolar",
    [{ name: "armsolar", fullName: "Solar Collector" }],
    { modelPending: true },
  );
  expect(await screen.findByRole("heading", { name: "Solar Collector" })).toBeTruthy();
  expect(screen.getByText("armsolar")).toBeTruthy();
});

it("says plainly when the game has no such unit", async () => {
  renderUnit("nosuchunit", [{ name: "armsolar" }]);
  expect(await screen.findByText(/not in this game/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/content/pages/GameUnitPage.dom.test.tsx`
Expected: FAIL, cannot resolve `./GameUnitPage`.

- [ ] **Step 3: Write the page**

Same preamble as Task 2, plus `const { unit: unitParam } = useParams()` lowercased, and the entry found by `dataset.units.find((u) => u.name.toLowerCase() === id)`.

Order on the page: the model viewport, then the unit's name as an `h1` with its def key and faction beneath it, then the buildpic. A unit the dataset does not hold renders a plain "That unit is not in this game" rather than an empty page or a crash, the way `NotFound` in `./components/states` is used elsewhere in this directory.

`UnitModelPanel` takes an `onClose`. This page has nowhere to close to, so pass a handler that navigates back to the grid.

- [ ] **Step 4: Register the route**

```ts
    {
      path: "content/games/:name/units/:unit",
      lazy: gateProfileHidden(
        "content.games",
        () => import("./pages/GameUnitPage"),
      ),
      crumb: (c) => c.params.unit ?? "Unit",
    },
```

The crumb is the def key rather than the display name, because the crumb renders before the dataset is read. A def key is a worse label than a name and a better one than nothing, and it is the trade the blueprint route already makes for a uuid.

- [ ] **Step 5: Run the tests and the linters**

Run: `bunx vitest run src/content/pages/GameUnitPage.dom.test.tsx`, then `bun run test`, `bunx biome ci .` and `bun run typecheck`.
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/content/pages/GameUnitPage.tsx src/content/pages/GameUnitPage.dom.test.tsx src/content/index.ts
git commit -m "Give every unit a page that leads with its model"
```

---

### Task 4: What the unit page tells you

**Files:**
- Create: `src/content/pages/components/UnitStatsTable.tsx`
- Create: `src/content/pages/components/UnitStatsTable.test.tsx`
- Modify: `src/content/pages/GameUnitPage.tsx`
- Modify: `src/content/pages/GameUnitPage.dom.test.tsx`

**Interfaces:**
- Consumes: `UnitDatasetEntry` and its `stats` map, `unitLabel` from Task 1, `morphGroups`/`groupOf` from `src/content/morphGraph.ts`.
- Produces: `UnitStatsTable({ unit }: { unit: UnitDatasetEntry })`, standalone so the build tree drawer can adopt it later. Moving the drawer onto it is not part of this work.

The stats a unit carries are documented in `shared/unitdef-stats.json`: `health`, `metalCost`, `energyCost`, `buildTime`, `sightDistance`, `maxVelocity`, `range`, and a `weapons` array whose entries hold `damage`, `reload`, `range` and `projectile`. The map is deliberately untyped, so render the keys that are present and skip the rest.

- [ ] **Step 1: Write the failing tests**

`UnitStatsTable.test.tsx`:

```tsx
it("shows a stat the def declares", () => {
  render(<UnitStatsTable unit={{ name: "armsolar", stats: { metalCost: 155 } }} />);
  expect(screen.getByText("Metal cost")).toBeTruthy();
  expect(screen.getByText("155")).toBeTruthy();
});

it("shows no row for a stat the def does not declare", () => {
  // Absent is a fact about the reader, not a claim about the game. A zero here
  // would be putting a number in the game's mouth.
  render(<UnitStatsTable unit={{ name: "armsolar", stats: { metalCost: 155 } }} />);
  expect(screen.queryByText("Health")).toBeNull();
});

it("lists a weapon's damage, reload, range and kind", () => {
  render(
    <UnitStatsTable
      unit={{
        name: "armflash",
        stats: {
          weapons: [{ damage: 32, reload: 0.3, range: 230, projectile: "LaserCannon" }],
        },
      }}
    />,
  );
  expect(screen.getByText("LaserCannon")).toBeTruthy();
  expect(screen.getByText("230")).toBeTruthy();
});

it("renders nothing at all for a unit with no stats", () => {
  const { container } = render(<UnitStatsTable unit={{ name: "armsolar" }} />);
  expect(container.textContent).toBe("");
});
```

Add to `GameUnitPage.dom.test.tsx`:

```tsx
it("links what it builds and what builds it", async () => {
  renderUnit("armlab", [
    { name: "armcom", fullName: "Commander", buildOptions: ["armlab"] },
    { name: "armlab", fullName: "Bot Lab", buildOptions: ["armpw"] },
    { name: "armpw", fullName: "Peewee" },
  ]);
  expect(await screen.findByRole("link", { name: "Peewee" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Commander" })).toBeTruthy();
});

it("lists a unit's morph stages with what the game asks for", async () => {
  renderUnit("fedcommander", [
    {
      name: "fedcommander",
      fullName: "Commander",
      morphTargets: [{ into: "fedcommander_up1", research: 150, require: "tech1" }],
    },
    { name: "fedcommander_up1", fullName: "Commander Tech 1" },
  ]);
  expect(await screen.findByRole("link", { name: "Commander Tech 1" })).toBeTruthy();
  expect(screen.getByText(/research/i)).toBeTruthy();
  expect(screen.getByText(/150/)).toBeTruthy();
});

it("shows where a building may stand", async () => {
  renderUnit("armsolar", [
    { name: "armsolar", footprintX: 4, footprintZ: 4, maxSlope: 10, floatOnWater: false },
  ]);
  expect(await screen.findByText(/4 by 4/)).toBeTruthy();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx vitest run src/content/pages/components/UnitStatsTable.test.tsx src/content/pages/GameUnitPage.dom.test.tsx`
Expected: FAIL, cannot resolve `./UnitStatsTable`, and the three new page tests find no links or terrain text.

- [ ] **Step 3: Write the stats table**

`UnitStatsTable.tsx` renders a definition list of the stats present, in the order `shared/unitdef-stats.json` lists them, with these labels: Health, Metal cost, Energy cost, Build time, Sight distance, Speed, Range. Then, when `stats.weapons` is a non-empty array, a table with a row per weapon and columns Damage, Reload, Range, Projectile, each cell empty when that weapon does not carry the field. A unit with no stats at all renders nothing rather than an empty heading.

- [ ] **Step 4: Add the sections to the unit page**

Below the identity block from Task 3, in this order:

1. `UnitStatsTable`.
2. What it builds: `unit.buildOptions` intersected with the dataset, each a link to that unit's page labelled with `unitLabel`.
3. What builds it: every dataset entry whose `buildOptions` include this unit, same link treatment.
4. Its morph stages: for each entry of `unit.morphTargets`, a link to the target and, beside it, every other key of that entry rendered as name and value. The keys are the game's own vocabulary and are not to be renamed or filtered.
5. Where it stands: footprint as "{x} by {y} squares", the maximum slope in degrees when present, whether it floats, and the water depth band when present.

Each section is omitted when it has nothing in it. A heading over an empty list is a worse answer than no heading.

- [ ] **Step 5: Run the tests and the linters**

Run: `bunx vitest run src/content/`, then `bun run test`, `bunx biome ci .` and `bun run typecheck`.
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/content/pages/components/UnitStatsTable.tsx src/content/pages/components/UnitStatsTable.test.tsx src/content/pages/GameUnitPage.tsx src/content/pages/GameUnitPage.dom.test.tsx
git commit -m "Tell a unit's page what the unit costs, builds and turns into"
```

---

## What this plan does not cover

Retired units, release history and author snippets, which are facts about a hub holding many versions rather than an archive on disk.

Unit comparison, which the hub has and a first version here does not need.

Moving `BuildTreeDrawer` onto `UnitStatsTable`. The component is built so the drawer can adopt it, and adopting it is separate work.

No agent drives the application. The visual result gets one `bun tauri dev` run at the end, against a game with morphs, which means SplinterFaction or Metal Factions.
